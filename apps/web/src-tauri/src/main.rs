// Evita la consola adicional en Windows en builds de release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    trazo_lib::run()
}
