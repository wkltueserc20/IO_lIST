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

/// D/M/L/F/SD/SM → 6 decimal digits; W/B/SB → 4 hex digits
fn addr_ascii_str(prefix: &str, addr: u32) -> String {
    match prefix.to_uppercase().as_str() {
        "W" | "B" | "SB" => format!("{:04X}", addr),
        _ => format!("{:06}", addr),
    }
}

// ── Binary frame (QnA 3E, 21 bytes) ──────────────────────────────────────────

fn build_bin_frame(dev_code: u8, addr: u32, count: u16, subcommand: u16) -> Vec<u8> {
    const DATA_LEN: u16 = 12; // body = timer(2)+cmd(2)+sub(2)+addr(3)+code(1)+count(2)
    let mut f = Vec::with_capacity(21);
    f.extend_from_slice(&[0x50, 0x00]);            // subheader
    f.push(0x00);                                   // network
    f.push(0xFF);                                   // PC
    f.extend_from_slice(&[0xFF, 0x03]);            // I/O = 0x03FF LE
    f.push(0x00);                                   // station
    f.extend_from_slice(&DATA_LEN.to_le_bytes());  // data length = 12
    f.extend_from_slice(&[0x10, 0x00]);            // timer 0x0010 (4 s)
    f.extend_from_slice(&[0x01, 0x04]);            // command 0x0401 LE
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
                // Binary response: 9-byte header + data_len bytes
                // data_len field at [7..9]; complete when raw.len() >= 9 + data_len
                if raw.len() >= 9 {
                    let data_len = u16::from_le_bytes([raw[7], raw[8]]) as usize;
                    if raw.len() >= 9 + data_len {
                        break;
                    }
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

/// Binary response:
/// [0..2] D0 00  [2] net  [3] PC  [4..6] I/O  [6] sta
/// [7..9] data_len (LE, includes end_code)
/// [9..11] end_code (LE)
/// [11..] data
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

/// QnA 3E ASCII header (14 chars, no serial/reserved):
/// "5000" + "00" + "FF" + "03FF" + "00" = "500000FF03FF00"
fn build_ascii_frame(dev_code_str: &str, addr_str: &str, count: u16, subcommand: u16) -> Vec<u8> {
    let body = format!(
        "0010{:04X}{:04X}{}{}{:04X}",
        0x0401u16, subcommand, addr_str, dev_code_str, count
    );
    // Header fixed (14 chars): sub(4)+net(2)+PC(2)+io(4)+sta(2)
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
                // ASCII response: 14-char header + 4-char data_len + data_len chars
                if raw.len() >= 18 {
                    if let Ok(s) = std::str::from_utf8(&raw) {
                        if let Ok(dl) = usize::from_str_radix(&s[14..18], 16) {
                            if raw.len() >= 18 + dl {
                                break;
                            }
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

/// ASCII response:
/// [0..4]   "D000" subheader
/// [4..6]   network  [6..8] PC  [8..12] I/O  [12..14] station
/// [14..18] data_len (4 hex chars, includes end_code chars)
/// [18..22] end_code (4 hex chars)
/// [22..]   data (4 hex chars per word)
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
        if i >= data.len() {
            return Err("Bit資料不足".to_string());
        }
        bits.push(&data[i..i + 1] != "0");
    }
    Ok(bits)
}

// ── Error descriptions ────────────────────────────────────────────────────────

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

#[derive(Clone, Copy, Debug)]
enum DataMode { Binary, Ascii }

/// Open ONE connection and detect mode on it.
/// Returns the open stream so callers can reuse it for all subsequent reads.
fn open_and_detect(ip: &str, port: u16) -> Result<(TcpStream, DataMode), String> {
    let mut s = connect(ip, port)?;
    // Binary probe: read D0
    let frame = build_bin_frame(0xA8, 0, 1, 0x0000);
    match send_recv_bin(&mut s, &frame) {
        Ok(raw) if !raw.is_empty() => {
            log::info!("[MELSEC] 偵測模式: Binary");
            return Ok((s, DataMode::Binary));
        }
        _ => {}
    }
    // Binary failed — reconnect and probe ASCII
    log::info!("[MELSEC] Binary無回應，嘗試ASCII模式");
    drop(s);
    let mut s2 = connect(ip, port)?;
    let frame2 = build_ascii_frame("D*", &addr_ascii_str("D", 0), 1, 0x0000);
    match send_recv_ascii(&mut s2, &frame2) {
        Ok(resp) if !resp.is_empty() => {
            log::info!("[MELSEC] 偵測模式: ASCII");
            Ok((s2, DataMode::Ascii))
        }
        _ => Err(
            "PLC無回應（Binary與ASCII均無回應）\n\
             請確認 GX Works3 → MELSEC通信協議連線設定".to_string()
        ),
    }
}

// ── High-level read primitives ────────────────────────────────────────────────

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
    if data.len() < 2 {
        return Err(format!("Word資料不足（{} bytes）", data.len()));
    }
    Ok(i16::from_le_bytes([data[0], data[1]]) as i32)
}

fn read_dword_bin(stream: &mut TcpStream, dev_code: u8, addr: u32) -> Result<u32, String> {
    let frame = build_bin_frame(dev_code, addr, 2, 0x0000);
    let raw = send_recv_bin(stream, &frame)?;
    if raw.is_empty() {
        return Err("PLC無回應（0 bytes）".to_string());
    }
    let data = extract_bin_data(&raw)?;
    if data.len() < 4 {
        return Err(format!("DWORD資料不足（{} bytes）", data.len()));
    }
    Ok(u32::from_le_bytes([data[0], data[1], data[2], data[3]]))
}

fn read_bit_bin(stream: &mut TcpStream, dev_code: u8, addr: u32) -> Result<bool, String> {
    let frame = build_bin_frame(dev_code, addr, 1, 0x0001);
    let raw = send_recv_bin(stream, &frame)?;
    if raw.is_empty() {
        return Err("PLC無回應（0 bytes）".to_string());
    }
    let data = extract_bin_data(&raw)?;
    if data.is_empty() {
        return Err("Bit回應資料空".to_string());
    }
    Ok(data[0] & 0x0F != 0)
}

fn read_word_ascii(stream: &mut TcpStream, prefix: &str, addr: u32) -> Result<i32, String> {
    let code = device_code_ascii(prefix).ok_or_else(|| format!("不支援的裝置: {}", prefix))?;
    let frame = build_ascii_frame(code, &addr_ascii_str(prefix, addr), 1, 0x0000);
    let s = send_recv_ascii(stream, &frame)?;
    if s.is_empty() {
        return Err("PLC無回應（0 chars）".to_string());
    }
    let words = extract_ascii_words(&s, 1)?;
    Ok(words[0])
}

fn read_dword_ascii(stream: &mut TcpStream, prefix: &str, addr: u32) -> Result<u32, String> {
    let code = device_code_ascii(prefix).ok_or_else(|| format!("不支援的裝置: {}", prefix))?;
    let frame = build_ascii_frame(code, &addr_ascii_str(prefix, addr), 2, 0x0000);
    let s = send_recv_ascii(stream, &frame)?;
    if s.is_empty() {
        return Err("PLC無回應（0 chars）".to_string());
    }
    let words = extract_ascii_words(&s, 2)?;
    let lo = words[0] as u16 as u32;
    let hi = words[1] as u16 as u32;
    Ok(lo | (hi << 16))
}

fn read_bit_ascii(stream: &mut TcpStream, prefix: &str, addr: u32) -> Result<bool, String> {
    let code = device_code_ascii(prefix).ok_or_else(|| format!("不支援的裝置: {}", prefix))?;
    let frame = build_ascii_frame(code, &addr_ascii_str(prefix, addr), 1, 0x0001);
    let s = send_recv_ascii(stream, &frame)?;
    if s.is_empty() {
        return Err("PLC無回應（0 chars）".to_string());
    }
    let bits = extract_ascii_bits(&s, 1)?;
    Ok(bits[0])
}

// ── Public API ────────────────────────────────────────────────────────────────

pub fn read_batch(ip: &str, port: u16, requests: Vec<ReadRequest>) -> Vec<ReadResult> {
    use std::collections::HashMap;

    // ONE connection for the entire batch — avoids FX5U connection-slot saturation.
    let (mut stream, mode) = match open_and_detect(ip, port) {
        Ok(pair) => pair,
        Err(e) => {
            return requests.iter().map(|r| ReadResult {
                address: r.address.clone(), value: None, error: Some(e.clone()),
            }).collect();
        }
    };

    let mut biw_groups: HashMap<(String, u32), Vec<(String, u8)>> = HashMap::new();
    let mut plain: Vec<ReadRequest> = Vec::new();

    for req in &requests {
        match parse_device_address(&req.address) {
            Some(PlcDevice::BitInWord { prefix, num, bit }) => {
                biw_groups.entry((prefix, num)).or_default().push((req.address.clone(), bit));
            }
            _ => plain.push(req.clone()),
        }
    }

    // All plain reads share the same stream
    let mut results: Vec<ReadResult> = plain
        .into_iter()
        .map(|req| match read_one(&mut stream, &req, mode) {
            Ok(v)  => ReadResult { address: req.address.clone(), value: Some(v),  error: None },
            Err(e) => ReadResult { address: req.address.clone(), value: None,      error: Some(e) },
        })
        .collect();

    // BitInWord: read each unique word once on the same stream
    for ((prefix, num), bits) in biw_groups {
        let word_result: Result<i32, String> = match mode {
            DataMode::Binary => {
                device_code_bin(&prefix)
                    .ok_or_else(|| format!("不支援的裝置: {}", prefix))
                    .and_then(|code| read_word_bin(&mut stream, code, num))
            }
            DataMode::Ascii => read_word_ascii(&mut stream, &prefix, num),
        };

        match word_result {
            Ok(raw_word) => {
                for (addr, bit) in &bits {
                    let on = (raw_word >> *bit) & 1 == 1;
                    results.push(ReadResult {
                        address: addr.clone(),
                        value: Some(if on { "ON" } else { "OFF" }.to_string()),
                        error: None,
                    });
                }
            }
            Err(e) => {
                for (addr, _) in &bits {
                    results.push(ReadResult {
                        address: addr.clone(), value: None, error: Some(e.clone()),
                    });
                }
            }
        }
    }

    let order: HashMap<&str, usize> = requests
        .iter()
        .enumerate()
        .map(|(i, r)| (r.address.as_str(), i))
        .collect();
    results.sort_by_key(|r| order.get(r.address.as_str()).copied().unwrap_or(usize::MAX));
    results
}

fn read_one(stream: &mut TcpStream, req: &ReadRequest, mode: DataMode) -> Result<String, String> {
    log::debug!("[MELSEC {:?}] {} {}", mode, req.data_type, req.address);

    let device = parse_device_address(&req.address)
        .ok_or_else(|| format!("無效位址: {}", req.address))?;

    match (&device, mode) {
        (PlcDevice::Bool { prefix, num }, DataMode::Binary) => {
            let code = device_code_bin(prefix).ok_or_else(|| format!("不支援: {}", prefix))?;
            read_bit_bin(stream, code, *num)
                .map(|b| if b { "ON" } else { "OFF" }.to_string())
        }
        (PlcDevice::Word { prefix, num }, DataMode::Binary) => {
            let code = device_code_bin(prefix).ok_or_else(|| format!("不支援: {}", prefix))?;
            match req.data_type.to_uppercase().as_str() {
                "DWORD" | "UDINT" => read_dword_bin(stream, code, *num).map(|v| v.to_string()),
                "DINT" => read_dword_bin(stream, code, *num).map(|v| (v as i32).to_string()),
                "FLOAT" => {
                    let v = read_dword_bin(stream, code, *num)?;
                    Ok(format!("{:.6}", f32::from_bits(v)))
                }
                // read_word_bin returns i16 as i32 (already signed); INT is correct as-is
                "INT" => read_word_bin(stream, code, *num).map(|v| v.to_string()),
                // UINT / WORD: cast i16 back to u16 to show unsigned 0-65535
                "UINT" | "WORD" => read_word_bin(stream, code, *num).map(|v| (v as u16).to_string()),
                _ => read_word_bin(stream, code, *num).map(|v| v.to_string()),
            }
        }
        (PlcDevice::BitInWord { prefix, num, bit }, DataMode::Binary) => {
            let code = device_code_bin(prefix).ok_or_else(|| format!("不支援: {}", prefix))?;
            let raw = read_word_bin(stream, code, *num)?;
            Ok(if (raw >> *bit) & 1 == 1 { "ON" } else { "OFF" }.to_string())
        }
        (PlcDevice::Bool { prefix, num }, DataMode::Ascii) => {
            read_bit_ascii(stream, prefix, *num)
                .map(|b| if b { "ON" } else { "OFF" }.to_string())
        }
        (PlcDevice::Word { prefix, num }, DataMode::Ascii) => {
            match req.data_type.to_uppercase().as_str() {
                "DWORD" | "UDINT" => read_dword_ascii(stream, prefix, *num).map(|v| v.to_string()),
                "DINT" => read_dword_ascii(stream, prefix, *num).map(|v| (v as i32).to_string()),
                "FLOAT" => {
                    let v = read_dword_ascii(stream, prefix, *num)?;
                    Ok(format!("{:.6}", f32::from_bits(v)))
                }
                "INT" => read_word_ascii(stream, prefix, *num).map(|v| v.to_string()),
                "UINT" | "WORD" => read_word_ascii(stream, prefix, *num).map(|v| (v as u16).to_string()),
                _ => read_word_ascii(stream, prefix, *num).map(|v| v.to_string()),
            }
        }
        (PlcDevice::BitInWord { prefix, num, bit }, DataMode::Ascii) => {
            let raw = read_word_ascii(stream, prefix, *num)?;
            Ok(if (raw >> *bit) & 1 == 1 { "ON" } else { "OFF" }.to_string())
        }
    }
}
