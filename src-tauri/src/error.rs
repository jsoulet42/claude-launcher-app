use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Configuration: {0}")]
    Config(String),
    #[error("Terminal PTY: {0}")]
    Pty(String),
    #[error("Git: {0}")]
    Git(String),
    #[error("IO: {0}")]
    Io(#[from] std::io::Error),
    #[error("Serialization: {0}")]
    Serde(#[from] serde_json::Error),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<AppError> for String {
    fn from(err: AppError) -> Self {
        err.to_string()
    }
}
