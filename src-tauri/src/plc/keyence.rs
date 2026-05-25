/// KEYENCE KV Upper-Link Protocol (KV-XLE02 / KV-EP21 / built-in Ethernet)
///
/// ASCII over TCP, default port 8501.
///
/// Command terminator : CR (0x0D) only.
/// Response terminator: LF + CR (0x0A 0x0D) — NOT the usual CR+LF.
///   The PLC also sends a single LF (0x0A) immediately on new TCP connections.
///
/// Commands (relevant subset):
///   RD  {device}\r               — read ONE word/bit; returns signed decimal
///   RDS {device} {count}\r       — read N consecutive words; space-separated signed decimals
///
/// Bit devices (MR, LR, B, CR, R): RD returns "0" or "1"
/// Word devices (DM, W, TM, ...): RD returns signed 16-bit decimal
/// Error response: E{code}  (e.g. "E1" = address error, "E0" = command error)
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use super::address::{parse_device_address, PlcDevice};
use super::batch::{build_word_groups, extract_value, WordGroup, WordSpec};
use super::{ReadRequest, ReadResult};

const TIMEOUT: Duration = Duration::from_secs(3);

// ── Connection ─────────────────────────────────────────────────────────────────

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

// ── Low-level I/O ──────────────────────────────────────────────────────────────

/// Send command and read one response line.
///
/// Protocol quirks handled here:
/// 1. KV sends a single LF (0x0A) on new TCP connect — skipped as leading whitespace.
/// 2. Response terminator is LF+CR (0x0A 0x0D); we stop at the first CR or LF
///    after receiving at least one non-whitespace byte.
/// 3. Leftover LF from the previous response's LF+CR terminator is also
///    skipped as leading whitespace.
fn send_recv(stream: &mut TcpStream, cmd: &str) -> Result<String, String> {
    log::debug!("[KEYENCE TX] {}", cmd.trim_end_matches('\r'));
    stream.write_all(cmd.as_bytes())
        .map_err(|e| format!("寫入失敗: {}", e))?;

    let mut resp = Vec::new();
    let mut buf = [0u8; 1];
    loop {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(_) => {
                match buf[0] {
                    b'\r' | b'\n' => {
                        if !resp.is_empty() {
                            break;
                        }
                    }
                    b => resp.push(b),
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock
                   || e.kind() == std::io::ErrorKind::TimedOut => break,
            Err(e) => return Err(format!("讀取失敗: {}", e)),
        }
    }

    let s = String::from_utf8(resp).map_err(|_| "回應含非UTF-8字元".to_string())?;
    log::debug!("[KEYENCE RX] {}", s);

    if s.len() >= 2
        && s.starts_with('E')
        && s.chars().nth(1).map_or(false, |c| c.is_ascii_digit())
    {
        return Err(format!("KV錯誤 {}: {}", s, kv_error_desc(&s)));
    }

    if s.is_empty() {
        return Err("KV無回應（逾時或連線中斷）".to_string());
    }

    Ok(s)
}

fn kv_error_desc(code: &str) -> &'static str {
    match code {
        "E0" => "命令格式錯誤",
        "E1" => "位址超出範圍或裝置類型錯誤",
        "E2" => "數值超出範圍",
        "E3" => "資料點數錯誤",
        "E4" => "命令字元數錯誤",
        "E5" => "指定裝置無法寫入（唯讀）",
        _ => "未知錯誤",
    }
}

// ── Primitive reads ────────────────────────────────────────────────────────────

fn read_word(stream: &mut TcpStream, prefix: &str, num: u32) -> Result<i32, String> {
    let cmd = format!("RD {}{}\r", prefix, num);
    let resp = send_recv(stream, &cmd)?;
    resp.parse::<i32>()
        .map_err(|_| format!("Word解析失敗: '{}'", resp))
}

fn read_bit(stream: &mut TcpStream, prefix: &str, num: u32) -> Result<String, String> {
    let cmd = format!("RD {}{}\r", prefix, num);
    let resp = send_recv(stream, &cmd)?;
    match resp.as_str() {
        "0" => Ok("OFF".to_string()),
        "1" => Ok("ON".to_string()),
        _ => Err(format!("Bit解析失敗: '{}'", resp)),
    }
}

// ── Batch read helpers ─────────────────────────────────────────────────────────

fn is_io_err(e: &str) -> bool {
    e.contains("寫入失敗") || e.contains("讀取失敗") || e.contains("無回應") || e.contains("連線失敗")
}

/// 執行一個 WordGroup 的批次讀取（RD 或 RDS）並填入 out 陣列。
/// 回傳 true 表示發生 I/O 錯誤（連線可能已斷）。
fn exec_word_group(stream: &mut TcpStream, group: &WordGroup, out: &mut [ReadResult]) -> bool {
    let count = (group.end - group.start) as u16;
    let cmd = if count == 1 {
        format!("RD {}{}\r", group.prefix, group.start)
    } else {
        format!("RDS {}{} {}\r", group.prefix, group.start, count)
    };

    let raw = match send_recv(stream, &cmd) {
        Err(e) => {
            let io = is_io_err(&e);
            for spec in &group.specs {
                out[spec.req_idx] = ReadResult { address: spec.address.clone(), value: None, error: Some(e.clone()) };
            }
            return io;
        }
        Ok(r) => r,
    };

    // RD 回傳單數字，RDS 回傳空白分隔的多數字
    let words: Vec<i32> = raw.split_whitespace()
        .filter_map(|s| s.parse::<i32>().ok())
        .collect();

    for spec in &group.specs {
        let offset = (spec.num - group.start) as usize;
        match extract_value(spec, &words, offset) {
            Ok(v) => out[spec.req_idx] = ReadResult { address: spec.address.clone(), value: Some(v), error: None },
            Err(e) => out[spec.req_idx] = ReadResult { address: spec.address.clone(), value: None, error: Some(e) },
        }
    }

    false
}

// ── Main batch logic ───────────────────────────────────────────────────────────

fn do_batch(stream: &mut TcpStream, requests: &[ReadRequest]) -> (Vec<ReadResult>, bool) {
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
        if exec_word_group(stream, &group, &mut out) { had_io = true; }
    }

    // 逐一讀取 BOOL（Bit 裝置，不支援 RDS）
    for (idx, prefix, num, addr) in &bool_list {
        match read_bit(stream, prefix, *num) {
            Ok(v) => out[*idx] = ReadResult { address: addr.clone(), value: Some(v), error: None },
            Err(e) => {
                if is_io_err(&e) { had_io = true; }
                out[*idx] = ReadResult { address: addr.clone(), value: None, error: Some(e) };
            }
        }
    }

    // BitInWord：每個 Word 只讀一次，提取多個 bit
    for ((prefix, num), bits) in &biw_map {
        match read_word(stream, prefix, *num) {
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
    let mk_err = |e: &str| requests.iter().map(|r| ReadResult {
        address: r.address.clone(), value: None, error: Some(e.to_string()),
    }).collect::<Vec<_>>();

    // 嘗試從 pool 取得既有連線，否則建立新連線
    let (stream_res, was_pooled) = match super::pool::kv_take(ip, port) {
        Some(s) => (Ok(s), true),
        None    => (connect(ip, port), false),
    };

    let mut stream = match stream_res {
        Ok(s)  => s,
        Err(e) => return mk_err(&e),
    };

    let (results, had_io) = do_batch(&mut stream, &requests);

    // 若從 pool 取出的舊連線發生 I/O 錯誤，以新連線重試一次
    if had_io && was_pooled {
        drop(stream);
        return match connect(ip, port) {
            Err(e) => mk_err(&e),
            Ok(mut fresh) => {
                let (r2, _) = do_batch(&mut fresh, &requests);
                super::pool::kv_put(ip, port, fresh);
                r2
            }
        };
    }

    // 正常完成：歸還連線供下次 tick 使用
    if !had_io { super::pool::kv_put(ip, port, stream); }

    results
}
