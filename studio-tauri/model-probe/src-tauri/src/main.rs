#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    model_probe::parse_cli_args();
    model_probe::run()
}
