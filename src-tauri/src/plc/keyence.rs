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
use super::{ReadRequest, ReadResult};

const TIMEOUT: Duration = Duration::from_secs(3);

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
                            break; // terminator after data
                        }
                        // else: skip leading CR/LF (banner or leftover from prev response)
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

    // Error responses: E0, E1, E2, E3, E4, E5
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

/// RD {prefix}{num}\r — read one word (signed 16-bit decimal)
fn read_word(stream: &mut TcpStream, prefix: &str, num: u32) -> Result<i32, String> {
    let cmd = format!("RD {}{}\r", prefix, num);
    let resp = send_recv(stream, &cmd)?;
    resp.parse::<i32>()
        .map_err(|_| format!("Word解析失敗: '{}'", resp))
}

/// RD {prefix}{num}\r — read one bit device (returns "0" or "1")
fn read_bit(stream: &mut TcpStream, prefix: &str, num: u32) -> Result<String, String> {
    let cmd = format!("RD {}{}\r", prefix, num);
    let resp = send_recv(stream, &cmd)?;
    match resp.as_str() {
        "0" => Ok("OFF".to_string()),
        "1" => Ok("ON".to_string()),
        _ => Err(format!("Bit解析失敗: '{}'", resp)),
    }
}

/// RDS {prefix}{num} 2\r — read two consecutive words (lo, hi) for 32-bit value
fn read_dword(stream: &mut TcpStream, prefix: &str, num: u32) -> Result<u32, String> {
    let cmd = format!("RDS {}{} 2\r", prefix, num);
    let resp = send_recv(stream, &cmd)?;
    let parts: Vec<&str> = resp.split_whitespace().collect();
    if parts.len() < 2 {
        return Err(format!("DWORD 回應需要2個值，實際: '{}'", resp));
    }
    let lo = parts[0].parse::<i32>()
        .map_err(|_| format!("低字解析失敗: '{}'", parts[0]))? as u16 as u32;
    let hi = parts[1].parse::<i32>()
        .map_err(|_| format!("高字解析失敗: '{}'", parts[1]))? as u16 as u32;
    Ok((hi << 16) | lo)
}

pub fn read_batch(ip: &str, port: u16, requests: Vec<ReadRequest>) -> Vec<ReadResult> {
    use std::collections::HashMap;

    let mut stream = match connect(ip, port) {
        Ok(s) => s,
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

    let mut results: Vec<ReadResult> = plain
        .into_iter()
        .map(|req| match read_one(&mut stream, &req) {
            Ok(v)  => ReadResult { address: req.address.clone(), value: Some(v),  error: None },
            Err(e) => ReadResult { address: req.address.clone(), value: None,      error: Some(e) },
        })
        .collect();

    for ((prefix, num), bits) in biw_groups {
        let word_result = read_word(&mut stream, &prefix, num);
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

fn read_one(stream: &mut TcpStream, req: &ReadRequest) -> Result<String, String> {
    log::debug!("[KEYENCE] {} {}", req.data_type, req.address);

    let device = parse_device_address(&req.address)
        .ok_or_else(|| format!("無效位址: {}", req.address))?;

    match &device {
        PlcDevice::Bool { prefix, num } => read_bit(stream, prefix, *num),

        PlcDevice::Word { prefix, num } => {
            match req.data_type.to_uppercase().as_str() {
                "DWORD" | "UDINT" => read_dword(stream, prefix, *num).map(|v| v.to_string()),
                "DINT" => read_dword(stream, prefix, *num).map(|v| (v as i32).to_string()),
                "FLOAT" => {
                    let v = read_dword(stream, prefix, *num)?;
                    Ok(format!("{:.6}", f32::from_bits(v)))
                }
                // KV default read is unsigned (.U); sign-extend to get signed 16-bit
                "INT" => read_word(stream, prefix, *num).map(|v| (v as u16 as i16).to_string()),
                // UINT / WORD: keep as unsigned 16-bit
                "UINT" | "WORD" => read_word(stream, prefix, *num).map(|v| (v as u16).to_string()),
                _ => read_word(stream, prefix, *num).map(|v| v.to_string()),
            }
        }

        PlcDevice::BitInWord { prefix, num, bit } => {
            let v = read_word(stream, prefix, *num)?;
            Ok(if (v >> *bit) & 1 == 1 { "ON" } else { "OFF" }.to_string())
        }
    }
}
