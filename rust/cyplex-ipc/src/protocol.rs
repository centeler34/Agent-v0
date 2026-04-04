use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::error::IpcError;

/// The type of an IPC message exchanged between daemon and CLI.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MessageType {
    TaskSubmit,
    TaskStatus,
    TaskCancel,
    TaskResult,
    AgentList,
    AgentStatus,
    SessionNew,
    SessionAttach,
    DaemonStatus,
    Ping,
    Pong,
    Error,
}

/// A single IPC message with a unique id, type, and JSON payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcMessage {
    pub id: String,
    pub msg_type: MessageType,
    pub payload: serde_json::Value,
}

impl IpcMessage {
    /// Create a new `IpcMessage` with an auto-generated UUID.
    pub fn new(msg_type: MessageType, payload: serde_json::Value) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            msg_type,
            payload,
        }
    }
}

/// Encode a message into a length-prefixed byte buffer.
///
/// Format: 4-byte big-endian length prefix followed by JSON bytes.
pub fn encode_message(msg: &IpcMessage) -> Result<Vec<u8>, IpcError> {
    let json_bytes = serde_json::to_vec(msg)
        .map_err(|e| IpcError::MessageEncodingError(e.to_string()))?;
    let len = json_bytes.len() as u32;
    let mut buf = Vec::with_capacity(4 + json_bytes.len());
    buf.extend_from_slice(&len.to_be_bytes());
    buf.extend_from_slice(&json_bytes);
    Ok(buf)
}

/// Decode a message from a byte buffer containing only the JSON payload
/// (no length prefix).
pub fn decode_message(buf: &[u8]) -> Result<IpcMessage, IpcError> {
    serde_json::from_slice(buf)
        .map_err(|e| IpcError::MessageDecodingError(e.to_string()))
}

/// Maximum allowed IPC message size (16 MiB). Prevents a malicious or
/// buggy peer from causing a multi-gigabyte allocation.
const MAX_MESSAGE_SIZE: usize = 16 * 1024 * 1024;

/// Read a single length-prefixed message from an async reader.
pub async fn read_message<R: AsyncRead + Unpin>(reader: &mut R) -> Result<IpcMessage, IpcError> {
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
            return Err(IpcError::ConnectionClosed);
        }
        Err(e) => return Err(IpcError::IoError(e)),
    }

    let len = u32::from_be_bytes(len_buf) as usize;
    if len == 0 {
        return Err(IpcError::MessageDecodingError(
            "zero-length message".to_string(),
        ));
    }
    if len > MAX_MESSAGE_SIZE {
        return Err(IpcError::MessageDecodingError(
            format!("message too large: {} bytes (max {})", len, MAX_MESSAGE_SIZE),
        ));
    }

    let mut msg_buf = vec![0u8; len];
    reader
        .read_exact(&mut msg_buf)
        .await
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::UnexpectedEof => IpcError::ConnectionClosed,
            _ => IpcError::IoError(e),
        })?;

    decode_message(&msg_buf)
}

/// Write a single length-prefixed message to an async writer.
pub async fn write_message<W: AsyncWrite + Unpin>(
    writer: &mut W,
    msg: &IpcMessage,
) -> Result<(), IpcError> {
    let encoded = encode_message(msg)?;
    writer
        .write_all(&encoded)
        .await
        .map_err(IpcError::IoError)?;
    writer.flush().await.map_err(IpcError::IoError)?;
    Ok(())
}
