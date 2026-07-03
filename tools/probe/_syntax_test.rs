use std::sync::Arc;

async fn test() -> Result<Option<u64>, String> {
    let cancel = Arc::new(());
    let live_emit: Box<dyn Fn(i32) + Send + Sync> = Box::new(move |_| ());
    let claimed: u64 = 100;
    let base_url = String::from("x");
    let api_key = String::from("y");
    let model = String::from("z");
    let r = tauri::async_runtime::spawn_blocking(move || {
        let _client = (base_url.clone(), api_key.clone(), model.clone());
        let _ = (cancel, live_emit, claimed);
        Ok::<Option<u64>, String>(Some(42))
    })
    .await
    .map_err(|e| format!("test join: {}", e))?;
    Ok(r)
}

fn main() {}
