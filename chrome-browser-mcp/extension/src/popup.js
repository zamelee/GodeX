const STATUS = document.getElementById("status");
const URL_EL = document.getElementById("url");
const OUTPUT = document.getElementById("output");
const SEL = document.getElementById("selector");

async function api(action, args) {
  try {
    const resp = await fetch("http://localhost:9223/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, args }),
    });
    const data = await resp.json();
    return data.result;
  } catch (e) {
    return "Error: " + e.message;
  }
}

async function init() {
  try {
    const resp = await fetch("http://localhost:9223/health");
    if (resp.ok) {
      STATUS.textContent = "Extension active";
      STATUS.className = "status ok";
    } else {
      STATUS.textContent = "Server error: " + resp.status;
      STATUS.className = "status err";
    }
  } catch (e) {
    STATUS.textContent = "Not reachable (start MCP with extension port 9223)";
    STATUS.className = "status err";
  }

  try {
    const r = await api("ping", {});
    URL_EL.textContent = r.url || JSON.stringify(r);
  } catch {}
}

async function doClick() {
  const sel = SEL.value;
  if (!sel) return;
  OUTPUT.textContent = "...";
  OUTPUT.textContent = await api("click", { selector: sel });
}

async function doType() {
  const sel = SEL.value;
  const text = document.getElementById("text_input").value;
  if (!sel) return;
  OUTPUT.textContent = "...";
  OUTPUT.textContent = await api("typeText", { selector: sel, text });
}

init();
