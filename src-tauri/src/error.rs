use serde::Serialize;

/// Errors surfaced to the frontend. Serialized as `{ kind, message }` so the UI
/// can branch on `kind` (e.g. show a conflict dialog) without parsing strings.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("No vault is open")]
    NoVault,
    #[error("Invalid path: {0}")]
    InvalidPath(String),
    #[error("Path escapes the vault: {0}")]
    OutsideVault(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Already exists: {0}")]
    AlreadyExists(String),
    #[error("Permission denied: {0}")]
    PermissionDenied(String),
    #[error("File changed on disk since it was loaded: {0}")]
    Conflict(String),
    #[error("Vault is not in the approved list: {0}")]
    NotApproved(String),
    #[error("File too large: {0}")]
    TooLarge(String),
    #[error("{0}")]
    Io(String),
}

impl AppError {
    fn kind(&self) -> &'static str {
        match self {
            AppError::NoVault => "noVault",
            AppError::InvalidPath(_) => "invalidPath",
            AppError::OutsideVault(_) => "outsideVault",
            AppError::NotFound(_) => "notFound",
            AppError::AlreadyExists(_) => "alreadyExists",
            AppError::PermissionDenied(_) => "permissionDenied",
            AppError::Conflict(_) => "conflict",
            AppError::NotApproved(_) => "notApproved",
            AppError::TooLarge(_) => "tooLarge",
            AppError::Io(_) => "io",
        }
    }

    pub fn from_io(err: std::io::Error, path: &str) -> Self {
        use std::io::ErrorKind;
        match err.kind() {
            ErrorKind::NotFound => AppError::NotFound(path.to_string()),
            ErrorKind::AlreadyExists => AppError::AlreadyExists(path.to_string()),
            ErrorKind::PermissionDenied => AppError::PermissionDenied(path.to_string()),
            _ => AppError::Io(format!("{path}: {err}")),
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("AppError", 2)?;
        st.serialize_field("kind", self.kind())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;
