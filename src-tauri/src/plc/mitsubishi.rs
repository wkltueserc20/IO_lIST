/// MELSEC iQ-F FX5U Ethernet Communication — QnA-compatible 3E frame
///
/// Frame layout (Binary, 21 bytes for batch-read):
///   [0..2]  Subheader  50 00
///   [2]     Network No.  00
///   [3]     PC No.  FF
///   [4..6]  Module I/O No.  FF 03  (= 0x03FF LE)
///   [6]     Station No.  00
///   [7..9]  Request data length LE  (body byte count, excluding this field)
///   ── body (12 bytes) ──
///   [9..11]   Monitor timer LE
///   [11..13]  Command LE  (0x0401 = batch read)
///   [13..15]  Subcommand LE  (0x0000 = word, 0x0001 = bit)
///   [15..18]  Head device No. (3 bytes LE)
///   [18]      Device code
///   [19..21]  Number of points LE
///
/// NOTE: SLMP 3E frame adds Serial(2)+Reserved(2) between Subheader and Network,
///       making it 25 bytes.  The FX5U CPU built-in Ethernet port uses the
///       shorter QnA-compatible 3E format (21 bytes), NOT SLMP 3E.
///       Sending SLMP frames causes the FX5U to interpret Serial bytes as data_len,
///       yielding an impossible data_len value, so it never responds.
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use super::address::{parse_device_address, PlcDevice};
use super::batch::{build_word_groups, extract_value, WordGroup, WordSpec};
use super::pool::MelsecMode;
use super::{ReadRequest, ReadResult};

const TIMEOUT: Duration = Duration::from_secs(3);

// ── Connection ────────────────────────────────────────────────────────────────

fn connect(ip: &str, port: u16) -> Result<TcpStream, String> {
    let addr: SocketAddr = format!("{}:{}", ip, port)
        .parse()
        .map_err(|e| format!("地址解析失敗: {}", e))?;
    let s = TcpStream::connect_timeout(&addr, TIMEOUT)
        .map_err(|e| format!("連線失敗: {}", e))?;
    s.set_read_timeout(Some(TIMEOUT)).map_err(|e| e.to_string())?;
    s.set_write_timeout(Some(TIMEOUT)).map_err(|e| e.to_string())?;
    Ok(s)
}

fn hex_dump(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02X}", b)).collect::<Vec<_>>().join(" ")
}

// ── Device codes ──────────────────────────────────────────────────────────────

fn device_code_bin(prefix: &str) -> Option<u8> {
    match prefix.to_uppercase().as_str() {
        "D"  => Some(0xA8),
        "W"  => Some(0xB4),
        "R"  => Some(0xAF),
        "ZR" => Some(0xB0),
        "M"  => Some(0x90),
        "L"  => Some(0x92),
        "B"  => Some(0xA0),
        "F"  => Some(0x93),
        "SB" => Some(0xA1),
        "SM" => Some(0x91),
        "SD" => Some(0xA9),
        _    => None,
    }
}

fn device_code_ascii(prefix: &str) -> Option<&'static str> {
    match prefix.to_uppercase().as_str() {
        "D"  => Some("D*"),
        "W"  => Some("W*"),
        "R"  => Some("R*"),
        "ZR" => Some("ZR"),
        "M"  => Some("M*"),
        "L"  => Some("L*"),
        "B"  => Some("B*"),
        "F"  => Some("F*"),
        "SB" => Some("SB"),
        "SM" => Some("SM"),
        "SD" => Some("SD"),
        _    => None,
    }
}

fn addr_ascii_str(prefix: &str, addr: u32) -> String {
    match prefix.to_uppercase().as_str() {
        "W" | "B" | "SB" => format!("{:04X}", addr),
        _ => format!("{:06}", addr),
    }
}

// ── Binary frame (QnA 3E, 21 bytes) ──────────────────────────────────────────

fn build_bin_frame(dev_code: u8, addr: u32, count: u16, subcommand: u16) -> Vec<u8> {
    const DATA_LEN: u16 = 12;
    let mut f = Vec::with_capacity(21);
    f.extend_from_slice(&[0x50, 0x00]);
    f.push(0x00);
    f.push(0xFF);
    f.extend_from_slice(&[0xFF, 0x03]);
    f.push(0x00);
    f.extend_from_slice(&DATA_LEN.to_le_bytes());
    f.extend_from_slice(&[0x10, 0x00]);
    f.extend_from_slice(&[0x01, 0x04]);
    f.extend_from_slice(&subcommand.to_le_bytes());
    f.push((addr & 0xFF) as u8);
    f.push(((addr >> 8) & 0xFF) as u8);
    f.push(((addr >> 16) & 0xFF) as u8);
    f.push(dev_code);
    f.extend_from_slice(&count.to_le_bytes());
    f
}

fn send_recv_bin(stream: &mut TcpStream, frame: &[u8]) -> Result<Vec<u8>, String> {
    log::debug!("[MELSEC BIN TX] {} bytes | {}", frame.len(), hex_dump(frame));
    stream.write_all(frame).map_err(|e| format!("寫入失敗: {}", e))?;

    let mut raw: Vec<u8> = Vec::new();
    let mut tmp = [0u8; 512];
    loop {
        match stream.read(&mut tmp) {
            Ok(0) => break,
            Ok(n) => {
                raw.extend_from_slice(&tmp[..n]);
                if raw.len() >= 9 {
                    let data_len = u16::from_le_bytes([raw[7], raw[8]]) as usize;
                    if raw.len() >= 9 + data_len { break; }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock
                   || e.kind() == std::io::ErrorKind::TimedOut => break,
            Err(e) => return Err(format!("讀取失敗: {}", e)),
        }
    }
    log::debug!("[MELSEC BIN RX] {} bytes | {}", raw.len(), hex_dump(&raw));
    Ok(raw)
}

fn extract_bin_data(raw: &[u8]) -> Result<&[u8], String> {
    if raw.len() < 11 {
        return Err(format!("回應太短（{} bytes）: {}", raw.len(), hex_dump(raw)));
    }
    if raw[0] != 0xD0 || raw[1] != 0x00 {
        return Err(format!(
            "非3E Binary回應（subheader {:02X} {:02X}）\
             — 請確認 GX Works3 通信數據代碼設為「Binary」",
            raw[0], raw[1]
        ));
    }
    let end_code = u16::from_le_bytes([raw[9], raw[10]]);
    if end_code != 0 {
        return Err(format!("PLC錯誤碼 {:04X}（{}）", end_code, slmp_error_desc(end_code)));
    }
    Ok(&raw[11..])
}

// ── ASCII frame (QnA 3E) ──────────────────────────────────────────────────────

fn build_ascii_frame(dev_code_str: &str, addr_str: &str, count: u16, subcommand: u16) -> Vec<u8> {
    let body = format!(
        "0010{:04X}{:04X}{}{}{:04X}",
        0x0401u16, subcommand, addr_str, dev_code_str, count
    );
    let frame = format!("500000FF03FF00{:04X}{}", body.len() as u16, body);
    log::debug!("[MELSEC ASCII TX] {} chars | {}", frame.len(), frame);
    frame.into_bytes()
}

fn send_recv_ascii(stream: &mut TcpStream, frame: &[u8]) -> Result<String, String> {
    stream.write_all(frame).map_err(|e| format!("寫入失敗: {}", e))?;

    let mut raw: Vec<u8> = Vec::new();
    let mut tmp = [0u8; 512];
    loop {
        match stream.read(&mut tmp) {
            Ok(0) => break,
            Ok(n) => {
                raw.extend_from_slice(&tmp[..n]);
                if raw.len() >= 18 {
                    if let Ok(s) = std::str::from_utf8(&raw) {
                        if let Ok(dl) = usize::from_str_radix(&s[14..18], 16) {
                            if raw.len() >= 18 + dl { break; }
                        }
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock
                   || e.kind() == std::io::ErrorKind::TimedOut => break,
            Err(e) => return Err(format!("讀取失敗: {}", e)),
        }
    }
    let s = String::from_utf8(raw.clone())
        .map_err(|_| format!("ASCII回應含非UTF-8: {}", hex_dump(&raw)))?;
    log::debug!("[MELSEC ASCII RX] {} chars | {}", s.len(), s);
    Ok(s)
}

fn extract_ascii_words(s: &str, count: usize) -> Result<Vec<i32>, String> {
    if s.len() < 22 {
        return Err(format!("ASCII回應太短: {} chars | {}", s.len(), s));
    }
    if !s.starts_with("D000") {
        return Err(format!(
            "非3E ASCII回應，開頭: {} — 可能PLC設為Binary模式",
            &s[..4.min(s.len())]
        ));
    }
    let end_code = u16::from_str_radix(&s[18..22], 16)
        .map_err(|_| "end_code解析失敗".to_string())?;
    if end_code != 0 {
        return Err(format!("PLC錯誤碼 {:04X}（{}）", end_code, slmp_error_desc(end_code)));
    }
    let data = &s[22..];
    let mut words = Vec::with_capacity(count);
    for i in 0..count {
        let start = i * 4;
        if start + 4 > data.len() {
            return Err(format!("Word資料不足: 需{}個words，只有{}chars", count, data.len()));
        }
        let w = i16::from_str_radix(&data[start..start + 4], 16)
            .map_err(|_| format!("Word[{}]解析失敗: {}", i, &data[start..start + 4]))?;
        words.push(w as i32);
    }
    Ok(words)
}

fn extract_ascii_bits(s: &str, count: usize) -> Result<Vec<bool>, String> {
    if s.len() < 22 {
        return Err(format!("ASCII回應太短: {} chars", s.len()));
    }
    if !s.starts_with("D000") {
        return Err(format!("非3E ASCII回應，開頭: {}", &s[..4.min(s.len())]));
    }
    let end_code = u16::from_str_radix(&s[18..22], 16)
        .map_err(|_| "end_code解析失敗".to_string())?;
    if end_code != 0 {
        return Err(format!("PLC錯誤碼 {:04X}（{}）", end_code, slmp_error_desc(end_code)));
    }
    let data = &s[22..];
    let mut bits = Vec::with_capacity(count);
    for i in 0..count {
        if i >= data.len() { return Err("Bit資料不足".to_string()); }
        bits.push(&data[i..i + 1] != "0");
    }
    Ok(bits)
}

fn slmp_error_desc(code: u16) -> &'static str {
    match code {
        0xC050 => "收到非法ASCII碼（PLC設為Binary模式）",
        0xC056 => "超過最大位址",
        0xC058 => "請求數據長度不符",
        0xC059 => "命令/子命令有誤",
        0xC05B => "無法對指定軟元件讀寫",
        0xC05C => "請求內容有誤（以bit單位對word元件讀寫）",
        0xC061 => "請求數據長度不符",
        0xC06F => "通信數據代碼不符（ASCII/Binary模式不一致）",
        _      => "未知錯誤",
    }
}

// ── Mode auto-detect ──────────────────────────────────────────────────────────

/// 開啟連線並偵測 Binary/ASCII 模式。
/// 結果快取至 pool，後續 tick 不需重新偵測。
fn open_and_detect(ip: &str, port: u16) -> Result<(TcpStream, MelsecMode), String> {
    let mut s = connect(ip, port)?;
    let frame = build_bin_frame(0xA8, 0, 1, 0x0000);
    match send_recv_bin(&mut s, &frame) {
        Ok(raw) if !raw.is_empty() => {
            log::info!("[MELSEC] 偵測模式: Binary");
            return Ok((s, MelsecMode::Binary));
        }
        _ => {}
    }
    log::info!("[MELSEC] Binary無回應，嘗試ASCII模式");
    drop(s);
    let mut s2 = connect(ip, port)?;
    let frame2 = build_ascii_frame("D*", &addr_ascii_str("D", 0), 1, 0x0000);
    match send_recv_ascii(&mut s2, &frame2) {
        Ok(resp) if !resp.is_empty() => {
            log::info!("[MELSEC] 偵測模式: ASCII");
            Ok((s2, MelsecMode::Ascii))
        }
        _ => Err(
            "PLC無回應（Binary與ASCII均無回應）\n\
             請確認 GX Works3 → MELSEC通信協議連線設定".to_string()
        ),
    }
}

// ── Primitive reads ────────────────────────────────────────────────────────────

fn read_word_bin(stream: &mut TcpStream, dev_code: u8, addr: u32) -> Result<i32, String> {
    let frame = build_bin_frame(dev_code, addr, 1, 0x0000);
    let raw = send_recv_bin(stream, &frame)?;
    if raw.is_empty() {
        return Err(
            "PLC無回應（0 bytes）\n\
             可能原因：\n\
             1. GX Works3 通信數據代碼設為ASCII（請改為Binary）\n\
             2. 確認乙太網端口已設為「MELSEC通信協議」連接".to_string()
        );
    }
    let data = extract_bin_data(&raw)?;
    if data.len() < 2 { return Err(format!("Word資料不足（{} bytes）", data.len())); }
    Ok(i16::from_le_bytes([data[0], data[1]]) as i32)
}

fn read_word_ascii(stream: &mut TcpStream, prefix: &str, addr: u32) -> Result<i32, String> {
    let code = device_code_ascii(prefix).ok_or_else(|| format!("不支援的裝置: {}", prefix))?;
    let frame = build_ascii_frame(code, &addr_ascii_str(prefix, addr), 1, 0x0000);
    let s = send_recv_ascii(stream, &frame)?;
    if s.is_empty() { return Err("PLC無回應（0 chars）".to_string()); }
    let words = extract_ascii_words(&s, 1)?;
    Ok(words[0])
}

fn read_bit_bin(stream: &mut TcpStream, dev_code: u8, addr: u32) -> Result<bool, String> {
    let frame = build_bin_frame(dev_code, addr, 1, 0x0001);
    let raw = send_recv_bin(stream, &frame)?;
    if raw.is_empty() { return Err("PLC無回應（0 bytes）".to_string()); }
    let data = extract_bin_data(&raw)?;
    if data.is_empty() { return Err("Bit回應資料空".to_string()); }
    Ok(data[0] & 0x0F != 0)
}

fn read_bit_ascii(stream: &mut TcpStream, prefix: &str, addr: u32) -> Result<bool, String> {
    let code = device_code_ascii(prefix).ok_or_else(|| format!("不支援的裝置: {}", prefix))?;
    let frame = build_ascii_frame(code, &addr_ascii_str(prefix, addr), 1, 0x0001);
    let s = send_recv_ascii(stream, &frame)?;
    if s.is_empty() { return Err("PLC無回應（0 chars）".to_string()); }
    let bits = extract_ascii_bits(&s, 1)?;
    Ok(bits[0])
}

// ── Batch primitives ───────────────────────────────────────────────────────────

/// 一次讀取 count 個連續 word（Binary 模式），回傳 i32 陣列。
fn read_word_batch_bin(stream: &mut TcpStream, dev_code: u8, addr: u32, count: u16) -> Result<Vec<i32>, String> {
    let frame = build_bin_frame(dev_code, addr, count, 0x0000);
    let raw = send_recv_bin(stream, &frame)?;
    if raw.is_empty() {
        return Err(
            "PLC無回應（0 bytes）\n\
             可能原因：\n\
             1. GX Works3 通信數據代碼設為ASCII（請改為Binary）\n\
             2. 確認乙太網端口已設為「MELSEC通信協議」連接".to_string()
        );
    }
    let data = extract_bin_data(&raw)?;
    let needed = (count as usize) * 2;
    if data.len() < needed {
        return Err(format!("批次Word資料不足（需{}bytes，得{}bytes）", needed, data.len()));
    }
    Ok((0..count as usize)
        .map(|i| i16::from_le_bytes([data[i * 2], data[i * 2 + 1]]) as i32)
        .collect())
}

/// 一次讀取 count 個連續 word（ASCII 模式），回傳 i32 陣列。
fn read_word_batch_ascii(stream: &mut TcpStream, prefix: &str, addr: u32, count: u16) -> Result<Vec<i32>, String> {
    let code = device_code_ascii(prefix).ok_or_else(|| format!("不支援裝置: {}", prefix))?;
    let frame = build_ascii_frame(code, &addr_ascii_str(prefix, addr), count, 0x0000);
    let s = send_recv_ascii(stream, &frame)?;
    if s.is_empty() { return Err("PLC無回應（0 chars）".to_string()); }
    extract_ascii_words(&s, count as usize)
}

// ── Batch read helpers ─────────────────────────────────────────────────────────

fn is_io_err(e: &str) -> bool {
    e.contains("寫入失敗") || e.contains("讀取失敗") || e.contains("無回應") || e.contains("連線失敗")
}

/// 執行一個 WordGroup 的批次讀取並填入 out 陣列。
/// 回傳 true 表示發生 I/O 錯誤。
fn exec_word_group(stream: &mut TcpStream, mode: MelsecMode, group: &WordGroup, out: &mut [ReadResult]) -> bool {
    let count = (group.end - group.start) as u16;

    let words_result: Result<Vec<i32>, String> = match mode {
        MelsecMode::Binary => match device_code_bin(&group.prefix) {
            Some(code) => read_word_batch_bin(stream, code, group.start, count),
            None => Err(format!("不支援裝置: {}", group.prefix)),
        },
        MelsecMode::Ascii => read_word_batch_ascii(stream, &group.prefix, group.start, count),
    };

    match words_result {
        Err(e) => {
            let io = is_io_err(&e);
            for spec in &group.specs {
                out[spec.req_idx] = ReadResult { address: spec.address.clone(), value: None, error: Some(e.clone()) };
            }
            io
        }
        Ok(words) => {
            for spec in &group.specs {
                let offset = (spec.num - group.start) as usize;
                match extract_value(spec, &words, offset) {
                    Ok(v) => out[spec.req_idx] = ReadResult { address: spec.address.clone(), value: Some(v), error: None },
                    Err(e) => out[spec.req_idx] = ReadResult { address: spec.address.clone(), value: None, error: Some(e) },
                }
            }
            false
        }
    }
}

// ── Main batch logic ───────────────────────────────────────────────────────────

fn do_batch(stream: &mut TcpStream, mode: MelsecMode, requests: &[ReadRequest]) -> (Vec<ReadResult>, bool) {
    use std::collections::HashMap;

    let mut out: Vec<ReadResult> = requests.iter().map(|r| ReadResult {
        address: r.address.clone(), value: None, error: Some("未讀取".to_string()),
    }).collect();
    let mut had_io = false;

    let mut word_specs: Vec<WordSpec> = Vec::new();
    let mut bool_list: Vec<(usize, String, u32, String)> = Vec::new();
    let mut biw_map: HashMap<(String, u32), Vec<(usize, u8, String)>> = HashMap::new();

    for (idx, req) in requests.iter().enumerate() {
        match parse_device_address(&req.address) {
            Some(PlcDevice::Word { prefix, num }) => {
                let wn = match req.data_type.to_uppercase().as_str() {
                    "DWORD" | "UDINT" | "DINT" | "FLOAT" => 2,
                    _ => 1,
                };
                word_specs.push(WordSpec {
                    req_idx: idx, prefix, num, words_needed: wn,
                    data_type: req.data_type.clone(), address: req.address.clone(),
                });
            }
            Some(PlcDevice::Bool { prefix, num }) => {
                bool_list.push((idx, prefix, num, req.address.clone()));
            }
            Some(PlcDevice::BitInWord { prefix, num, bit }) => {
                biw_map.entry((prefix, num)).or_default().push((idx, bit, req.address.clone()));
            }
            None => {
                out[idx].error = Some(format!("無效位址: {}", req.address));
            }
        }
    }

    // 批次讀取連續 WORD 地址
    for group in build_word_groups(word_specs) {
        if exec_word_group(stream, mode, &group, &mut out) { had_io = true; }
    }

    // 逐一讀取 BOOL
    for (idx, prefix, num, addr) in &bool_list {
        let r = match mode {
            MelsecMode::Binary => device_code_bin(prefix)
                .ok_or_else(|| format!("不支援裝置: {}", prefix))
                .and_then(|code| read_bit_bin(stream, code, *num))
                .map(|b| if b { "ON" } else { "OFF" }.to_string()),
            MelsecMode::Ascii => read_bit_ascii(stream, prefix, *num)
                .map(|b| if b { "ON" } else { "OFF" }.to_string()),
        };
        match r {
            Ok(v) => out[*idx] = ReadResult { address: addr.clone(), value: Some(v), error: None },
            Err(e) => {
                if is_io_err(&e) { had_io = true; }
                out[*idx] = ReadResult { address: addr.clone(), value: None, error: Some(e) };
            }
        }
    }

    // BitInWord：每個 Word 只讀一次，提取多個 bit
    for ((prefix, num), bits) in &biw_map {
        let word_result: Result<i32, String> = match mode {
            MelsecMode::Binary => device_code_bin(prefix)
                .ok_or_else(|| format!("不支援裝置: {}", prefix))
                .and_then(|code| read_word_bin(stream, code, *num)),
            MelsecMode::Ascii => read_word_ascii(stream, prefix, *num),
        };
        match word_result {
            Ok(raw_word) => {
                for (idx, bit, addr) in bits {
                    let on = (raw_word >> *bit) & 1 == 1;
                    out[*idx] = ReadResult {
                        address: addr.clone(),
                        value: Some(if on { "ON" } else { "OFF" }.to_string()),
                        error: None,
                    };
                }
            }
            Err(e) => {
                if is_io_err(&e) { had_io = true; }
                for (idx, _, addr) in bits {
                    out[*idx] = ReadResult { address: addr.clone(), value: None, error: Some(e.clone()) };
                }
            }
        }
    }

    (out, had_io)
}

// ── Public API ─────────────────────────────────────────────────────────────────

pub fn read_batch(ip: &str, port: u16, requests: Vec<ReadRequest>) -> Vec<ReadResult> {
    use super::pool;

    let mk_err = |e: &str| requests.iter().map(|r| ReadResult {
        address: r.address.clone(), value: None, error: Some(e.to_string()),
    }).collect::<Vec<_>>();

    // 嘗試從 pool 取得既有連線（含已偵測的模式），否則重新偵測
    let (mut stream, mode, was_pooled) = match pool::melsec_take(ip, port) {
        Some((s, m)) => (s, m, true),
        None => match open_and_detect(ip, port) {
            Ok((s, m)) => (s, m, false),
            Err(e) => return mk_err(&e),
        },
    };

    let (results, had_io) = do_batch(&mut stream, mode, &requests);

    // 若從 pool 取出的舊連線發生 I/O 錯誤，以新連線重試一次（含模式重偵測）
    if had_io && was_pooled {
        drop(stream);
        return match open_and_detect(ip, port) {
            Err(e) => mk_err(&e),
            Ok((mut fresh, new_mode)) => {
                let (r2, _) = do_batch(&mut fresh, new_mode, &requests);
                pool::melsec_put(ip, port, fresh, new_mode);
                r2
            }
        };
    }

    // 正常完成：歸還連線供下次 tick 使用
    if !had_io { pool::melsec_put(ip, port, stream, mode); }

    results
}
