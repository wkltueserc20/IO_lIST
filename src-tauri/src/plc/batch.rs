/// 連續地址合併批次讀取的共用結構與算法
/// KEYENCE 與 Mitsubishi 都使用相同的分組邏輯。

/// 允許合併的最大地址間隙（不超過此數的空白 word 會被一起讀取後丟棄）
const MERGE_GAP: u32 = 4;
/// 單次批次讀取的最大 word 數
const MAX_BATCH: u32 = 100;

pub struct WordSpec {
    pub req_idx: usize,
    pub prefix: String,
    pub num: u32,
    pub words_needed: u32,
    pub data_type: String,
    pub address: String,
}

pub struct WordGroup {
    pub prefix: String,
    pub start: u32,
    pub end: u32,   // exclusive，count = end - start
    pub specs: Vec<WordSpec>,
}

/// 將 WordSpec 列表依 (prefix, num) 排序後，合併為儘量少的連續區段。
pub fn build_word_groups(mut specs: Vec<WordSpec>) -> Vec<WordGroup> {
    specs.sort_unstable_by(|a, b| a.prefix.cmp(&b.prefix).then(a.num.cmp(&b.num)));
    let mut groups: Vec<WordGroup> = Vec::new();

    for spec in specs {
        let spec_end = spec.num + spec.words_needed;
        let can_merge = groups.last().map_or(false, |g| {
            g.prefix == spec.prefix
                && spec.num <= g.end.saturating_add(MERGE_GAP)
                && spec_end.saturating_sub(g.start) <= MAX_BATCH
        });
        if can_merge {
            let g = groups.last_mut().unwrap();
            if spec_end > g.end { g.end = spec_end; }
            g.specs.push(spec);
        } else {
            groups.push(WordGroup {
                prefix: spec.prefix.clone(),
                start: spec.num,
                end: spec_end,
                specs: vec![spec],
            });
        }
    }
    groups
}

/// 從批次讀取結果中，依資料類型提取單個 spec 的值。
/// words: 整個批次的 i32 陣列，offset: spec.num - group.start。
pub fn extract_value(spec: &WordSpec, words: &[i32], offset: usize) -> Result<String, String> {
    if offset >= words.len() {
        return Err(format!("批次索引超界 (offset={}, len={})", offset, words.len()));
    }
    match spec.data_type.to_uppercase().as_str() {
        "DWORD" | "UDINT" => {
            if offset + 1 >= words.len() {
                return Err("DWORD 批次結果不足".to_string());
            }
            let lo = words[offset] as u16 as u32;
            let hi = words[offset + 1] as u16 as u32;
            Ok(((hi << 16) | lo).to_string())
        }
        "DINT" => {
            if offset + 1 >= words.len() {
                return Err("DINT 批次結果不足".to_string());
            }
            let lo = words[offset] as u16 as u32;
            let hi = words[offset + 1] as u16 as u32;
            Ok((((hi << 16) | lo) as i32).to_string())
        }
        "FLOAT" => {
            if offset + 1 >= words.len() {
                return Err("FLOAT 批次結果不足".to_string());
            }
            let lo = words[offset] as u16 as u32;
            let hi = words[offset + 1] as u16 as u32;
            Ok(format!("{:.6}", f32::from_bits((hi << 16) | lo)))
        }
        "INT" => Ok((words[offset] as u16 as i16).to_string()),
        _ => Ok((words[offset] as u16).to_string()), // WORD, UINT
    }
}
