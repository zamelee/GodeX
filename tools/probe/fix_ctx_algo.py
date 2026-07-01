src = r"D:\Documents\VibeCoding\GodeX\studio-tauri\src-tauri\src\probe.rs"
content = open(src, "r", encoding="utf-8").read()
# Replace ctx algorithm: continuous exponential up + bisect
old = """        let mut last_ok = claimed;
        for mult in [1u64, 2, 4] {
            let test = claimed.saturating_mul(mult);
            let r = self.client.post(&url).headers(headers.clone()).json(&build_body(test)).send();
            match r {
                Ok(resp) if resp.status().is_success() => {
                    self.emit(ProbeEvent::info("ctx", "ok", &format!("test={} status=200", test)));
                    last_ok = test;
                }
                Ok(resp) => {
                    let s = resp.status().as_u16();
                    self.emit(ProbeEvent::info("ctx", "fail", &format!("test={} status={}", test, s)));
                    if test <= claimed { return Some(last_ok); }
                    let mut lo = last_ok;
                    let mut hi = test;
                    while hi.saturating_sub(lo) > 1024 {
                        let mid = (lo + hi) / 2;
                        let r2 = self.client.post(&url).headers(headers.clone()).json(&build_body(mid)).send();
                        match r2 {
                            Ok(resp2) if resp2.status().is_success() => {
                                self.emit(ProbeEvent::info("ctx", "bisect", &format!("lo={} mid={} hi={} status=200", lo, mid, hi)));
                                lo = mid;
                            }
                            _ => {
                                self.emit(ProbeEvent::info("ctx", "bisect", &format!("lo={} mid={} hi={} status!=200", lo, mid, hi)));
                                hi = mid;
                            }
                        }
                    }
                    last_ok = lo;
                    break;
                }
                Err(e) => {
                    self.emit(ProbeEvent::fail("ctx", &format!("test={} err={}", test, e)));
                    return Some(last_ok);
                }
            }
        }
        self.emit(ProbeEvent::info("ctx", "done", &format!("ctx={}", last_ok)));
        Some(last_ok)
    }
}"""
new = """        // Continuous exponential up: claimed, claimed*2, claimed*4, claimed*8, ... until fail or ceiling
        let ceiling = 10_000_000u64; // 10M tokens hard cap
        let mut last_ok = claimed;
        let mut test = claimed;
        loop {
            let r = self.client.post(&url).headers(headers.clone()).json(&build_body(test)).send();
            match r {
                Ok(resp) if resp.status().is_success() => {
                    self.emit(ProbeEvent::info("ctx", "ok", &format!("test={} status=200", test)));
                    last_ok = test;
                    let next = test.saturating_mul(2);
                    if next > ceiling || next == test {
                        self.emit(ProbeEvent::info("ctx", "ceiling", &format!("hit ceiling={}", ceiling)));
                        break;
                    }
                    test = next;
                }
                Ok(resp) => {
                    let s = resp.status().as_u16();
                    self.emit(ProbeEvent::info("ctx", "fail", &format!("test={} status={}", test, s)));
                    if test <= claimed { return Some(last_ok); }
                    // Bisect [last_ok, test]
                    let mut lo = last_ok;
                    let mut hi = test;
                    while hi.saturating_sub(lo) > 1024 {
                        let mid = (lo + hi) / 2;
                        let r2 = self.client.post(&url).headers(headers.clone()).json(&build_body(mid)).send();
                        match r2 {
                            Ok(resp2) if resp2.status().is_success() => {
                                self.emit(ProbeEvent::info("ctx", "bisect", &format!("lo={} mid={} hi={} status=200", lo, mid, hi)));
                                lo = mid;
                            }
                            _ => {
                                self.emit(ProbeEvent::info("ctx", "bisect", &format!("lo={} mid={} hi={} status!=200", lo, mid, hi)));
                                hi = mid;
                            }
                        }
                    }
                    last_ok = lo;
                    break;
                }
                Err(e) => {
                    self.emit(ProbeEvent::fail("ctx", &format!("test={} err={}", test, e)));
                    return Some(last_ok);
                }
            }
        }
        self.emit(ProbeEvent::info("ctx", "done", &format!("ctx={}", last_ok)));
        Some(last_ok)
    }
}"""
if old in content:
    content = content.replace(old, new, 1)
    open(src, "w", encoding="utf-8").write(content)
    print("Fixed ctx algo: continuous exp up + bisect, ceiling 10M")
else:
    print("NOT FOUND")
