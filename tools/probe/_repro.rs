
use std::sync::Arc;
async fn test() -> Result<u64, String> {
    let r: Result<Result<u64, String>, Arc<tokio::task::JoinError>>;
    r = tauri::async_runtime::spawn_blocking(move || -> Result<u64, String> {
        Ok(42u64)
    })
    .await;
    Ok(0)
}
fn main() {}
