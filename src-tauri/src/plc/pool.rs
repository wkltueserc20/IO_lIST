use std::collections::HashMap;
use std::net::TcpStream;
use std::sync::{Mutex, OnceLock};

#[derive(Clone, Copy, Debug)]
pub enum MelsecMode { Binary, Ascii }

type KvMap = Mutex<HashMap<(String, u16), TcpStream>>;
type MelsecMap = Mutex<HashMap<(String, u16), (TcpStream, MelsecMode)>>;

static KV_POOL: OnceLock<KvMap> = OnceLock::new();
static MELSEC_POOL: OnceLock<MelsecMap> = OnceLock::new();

fn kv_pool() -> &'static KvMap {
    KV_POOL.get_or_init(|| Mutex::new(HashMap::new()))
}

fn melsec_pool() -> &'static MelsecMap {
    MELSEC_POOL.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn kv_take(ip: &str, port: u16) -> Option<TcpStream> {
    kv_pool().lock().unwrap().remove(&(ip.to_string(), port))
}

pub fn kv_put(ip: &str, port: u16, stream: TcpStream) {
    kv_pool().lock().unwrap().insert((ip.to_string(), port), stream);
}

pub fn melsec_take(ip: &str, port: u16) -> Option<(TcpStream, MelsecMode)> {
    melsec_pool().lock().unwrap().remove(&(ip.to_string(), port))
}

pub fn melsec_put(ip: &str, port: u16, stream: TcpStream, mode: MelsecMode) {
    melsec_pool().lock().unwrap().insert((ip.to_string(), port), (stream, mode));
}
