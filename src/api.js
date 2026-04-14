import axios from "axios";

export async function transcribeAudio(audioBlob) {
  const formData = new FormData();
  formData.append("file", audioBlob, "recording.webm");
  formData.append("model", "whisper-1");
  formData.append("language", "ja");
  const response = await axios.post(
    "https://api.openai.com/v1/audio/transcriptions",
    formData,
    { headers: { Authorization: `Bearer ${import.meta.env.VITE_OPENAI_API_KEY}`, "Content-Type": "multipart/form-data" } }
  );
  return response.data.text;
}

export async function getJournalFeedback(todayEntry, pastEntries = []) {
  const pastContext = pastEntries.length > 0
    ? `【過去の日記】\n` + pastEntries.map((e) => `${e.date.slice(0, 10)}: ${e.text}`).join("\n\n")
    : "（まだ過去の記録はありません）";
  const prompt = `あなたはJeffersonの「もう1人の客観的な自分」です。以下のルールで日記にフィードバックしてください：\n- 感情的に寄り添わず、客観的・分析的に返す\n- 気づいていないパターンや矛盾を指摘する\n- 過去の記録と比較して変化を伝える\n- 最後に1つだけ「明日への問い」を投げかける\n\n${pastContext}\n\n【今日の日記】\n${todayEntry}`;
  const response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    { model: "claude-sonnet-4-20250514", max_tokens: 1024, messages: [{ role: "user", content: prompt }] },
    { headers: { "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json", "anthropic-dangerous-direct-browser-access": "true" } }
  );
  return response.data.content[0].text;
}
