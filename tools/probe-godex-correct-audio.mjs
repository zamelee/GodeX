// probe-godex-correct-audio.mjs
// 用 GodeX 真正的 input_audio 格式 ({type:"input_audio", input_audio:{data,format}})
// 重测 minnimax.chat 的 audio 处理，看是不是 GodeX 内部走的路径其实能成功。

const PNG_1X1_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
const PNG_1X1_URL = `data:image/png;base64,${PNG_1X1_B64}`;

// 1KB 静音 WAV 用 Python 生成: data:audio/wav;base64,<...>
const WAV_B64 = "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

const base = "https://minnimax.chat/v1";
const key = process.env.MINIMAX_KEY ?? "";
if (!key) { console.log("set MINIMAX_KEY"); process.exit(1); }

const models = ["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M3"];

async function call(model, messages, max_tokens=2048) {
    const r = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            model,
            reasoning_split: true,
            max_completion_tokens: max_tokens,
            messages,
        }),
    });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0,300) }; }
    return { status: r.status, body };
}

function replyOf(j) {
    const c = j?.choices?.[0]?.message?.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.map(p => p?.text ?? "").join("");
    return "";
}

(async () => {
    for (const m of models) {
        console.log(`\n=== ${m} ===`);
        // 1) input_audio (GodeX 形状)
        let r = await call(m, [{ role:"user", content:[
            { type:"input_audio", input_audio:{ data: WAV_B64, format:"wav" } },
            { type:"text", text:"Transcribe or describe this audio in 1-2 sentences." },
        ]}], 1024);
        console.log(`  input_audio  status=${r.status}  reply=${replyOf(r.body).slice(0,160).replace(/\n/g," / ")}`);
        // 2) image_url inline (GodeX 形状)
        r = await call(m, [{ role:"user", content:[
            { type:"text", text:"What color is the dominant pixel?" },
            { type:"image_url", image_url:{ url: PNG_1X1_URL, detail:"low" } },
        ]}], 1024);
        console.log(`  image_url    status=${r.status}  reply=${replyOf(r.body).slice(0,160).replace(/\n/g," / ")}`);
        // 3) 纯文本对照
        r = await call(m, [{ role:"user", content:"Reply with the single word: pong" }], 64);
        console.log(`  text_only    status=${r.status}  reply=${replyOf(r.body).slice(0,80).replace(/\n/g," / ")}`);
    }
})();