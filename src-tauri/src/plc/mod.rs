pub mod address;
pub mod keyence;
pub mod mitsubishi;

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ReadRequest {
    pub address: String,
    pub data_type: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ReadResult {
    pub address: String,
    pub value: Option<String>,
    pub error: Option<String>,
}
