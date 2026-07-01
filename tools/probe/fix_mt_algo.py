src = r"D:\Documents\VibeCoding\GodeX\studio-tauri\src-tauri\src\probe.rs"
content = open(src, "r", encoding="utf-8").read()
old = """        let mut last_ok = claimed;
        for mult in [1u64, 2, 4] {
            let test = claimed.saturating_mul(mult);
            let r = self.client.post(&url).headers(headers.clone()).json(&build_body(test)).send();
            match r {
                Ok(resp) if resp.status().is_success() => {
                    self.emit(ProbeEvent::info("max_tokens", "ok", &format!("mt={} status=200", test)));
                    last_ok = test;
                }
                Ok(resp) => {
                    let s = resp.status().as_u16();
                    self.emit(ProbeEvent::info("max_tokens", "fail", &format!("mt={} status={}", test, s)));
                    if test <= claimed { return Some(last_ok); }
                    let mut lo = last_ok;
                    let mut hi = test;
                    while hi.saturating_sub(lo) > 512 {
                        let mid = (lo + hi) / 2;
                        let r2 = self.client.post(&url).headers(headers.clone()).json(&build_body(mid)).send();
                        match r2 {
                            Ok(resp2) if resp2.status().is_success() => {
                                self.emit(ProbeEvent::info("max_tokens", "bisect", &format!("lo={} mid={} hi={} status=200", lo, mid, hi)));
                                lo = mid;
                            }
                            _ => {
                                self.emit(ProbeEvent::info("max_tokens", "bisect", &format!("lo={} mid={} hi={} status!=200", lo, mid, hi)));
                                hi = mid;
                            }
                        }
                    }
                    last_ok = lo;
                    break;
                }
                Err(e) => {
                    self.emit(ProbeEvent::fail("max_tokens", &format!("mt={} err={}", test, e)));
                    return Some(last_ok);
                }
            }
        }
        self.emit(ProbeEvent::info("max_tokens", "done", &format!("mt={}", last_ok)));
        Some(last_ok)
    }
}"""
new = """        // Continuous exponential up: claimed, claimed*2, claimed*4, ... until fail or ceiling
        let ceiling = 1_000_000u64; // 1M tokens hard cap (output is usually smaller than ctx)
        let mut last_ok = claimed;
        let mut test = claimed;
        loop {
            let r = self.client.post(&url).headers(headers.clone()).json(&build_body(test)).send();
            match r {
                Ok(resp) if resp.status().is_success() => {
                    self.emit(ProbeEvent::info("max_tokens", "ok", &format!("mt={} status=200", test)));
                    last_ok = test;
                    let next = test.saturating_mul(2);
                    if next > ceiling || next == test {
                        self.emit(ProbeEvent::info("max_tokens", "ceiling", &format!("hit ceiling={}", ceiling)));
                        break;
                    }
                    test = next;
                }
                Ok(resp) => {
                    let s = resp.status().as_u16();
                    self.emit(ProbeEvent::info("max_tokens", "fail", &format!("mt={} status={}", test, s)));
                    if test <= claimed { return Some(last_ok); }
                    let mut lo = last_ok;
                    let mut hi = test;
                    while hi.saturating_sub(lo) > 512 {
                        let mid = (lo + hi) / 2;
                        let r2 = self.client.post(&url).headers(headers.clone()).json(&build_body(mid)).send();
                        match r2 {
                            Ok(resp2) if resp2.status().is_success() => {
                                self.emit(ProbeEvent::info("max_tokens", "bisect", &format!("lo={} mid={} hi={} status=200", lo, mid, hi)));
                                lo = mid;
                            }
                            _ => {
                                self.emit(ProbeEvent::info("max_tokens", "bisect", &format!("lo={} mid={} hi={} status!=200", lo, mid, hi)));
                                hi = mid;
                            }
                        }
                    }
                    last_ok = lo;
                    break;
                }
                Err(e) => {
                    self.emit(ProbeEvent::fail("max_tokens", &format!("mt={} err={}", test, e)));
                    return Some(last_ok);
                }
            }
        }
        self.emit(ProbeEvent::info("max_tokens", "done", &format!("mt={}", last_ok)));
        Some(last_ok)
    }
}"""
if old in content:
    content = content.replace(old, new, 1)
    open(src, "w", encoding="utf-8").write(content)
    print("Fixed max_tokens algo: continuous exp up + bisect, ceiling 1M")
else:
    print("NOT FOUND")
