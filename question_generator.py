"""
question_generator.py — حروف مع حسن
يولّد أسئلة عربية باستخدام Claude API (claude-haiku)
يُستدعى من server.js عبر child_process.spawn
"""
import sys, json, os, urllib.request, time

API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL   = "claude-haiku-4-5-20251001"

CATEGORY_EXAMPLES = {
    "كروي":    "لاعبون، أندية، بطولات، مدربون",
    "ديني":    "أنبياء، صحابة، سور قرآنية، مصطلحات دينية",
    "علوم":    "حيوانات، نباتات، ظواهر طبيعية، مفاهيم علمية",
    "جغرافيا": "دول، مدن، جبال، أنهار، عواصم",
    "علمي":    "علماء، اختراعات، مصطلحات تقنية، فيزياء وكيمياء",
    "ثقافي":   "شخصيات تاريخية، أفلام، كتب، فنون",
    "عشوائي":  "أي تصنيف متنوع",
}

def generate(letter: str, category: str, difficulty: str, count: int) -> list:
    if not API_KEY:
        return make_fallback(letter, count)

    cat_hint = CATEGORY_EXAMPLES.get(category, "متنوع")
    diff_map = {"سهل": "معروفة جداً وشائعة", "متوسط": "متوسطة الشهرة", "صعب": "نادرة ومتخصصة"}
    diff_hint = diff_map.get(difficulty, "متوسطة")

    system = (
        "أنت مولّد أسئلة ذكي للعبة 'حروف مع حسن'. "
        "القاعدة الذهبية: الإجابة يجب أن تبدأ بالحرف المطلوب تماماً. "
        "الأسئلة باللغة العربية الفصيحة. "
        "أرجع JSON فقط، بدون أي نص خارجه أو markdown."
    )

    user = f"""اصنع {count} أسئلة مختلفة ومتنوعة لحرف «{letter}».

المعطيات:
- التصنيف: {category} ({cat_hint})
- الصعوبة: {difficulty} (إجابات {diff_hint})

شروط مهمة:
1. كل إجابة يجب أن تبدأ بحرف «{letter}» بالضبط
2. الأسئلة يجب أن تكون واضحة ومحددة
3. التلميح يساعد دون أن يكشف الإجابة
4. تنوع الأسئلة بين {'ونفس التصنيف' if category != 'عشوائي' else 'تصنيفات مختلفة'}

أرجع هذا JSON بالضبط:
[
  {{
    "text": "نص السؤال الواضح",
    "answer": "الإجابة الصحيحة (تبدأ بـ{letter})",
    "hint": "تلميح مفيد لا يكشف الإجابة",
    "category": "التصنيف",
    "difficulty": "{difficulty}"
  }}
]"""

    payload = json.dumps({
        "model": MODEL,
        "max_tokens": 1200,
        "temperature": 0.85,
        "system": system,
        "messages": [{"role": "user", "content": user}]
    }).encode()

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={
            "x-api-key": API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        method="POST"
    )

    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=14) as resp:
                data = json.loads(resp.read())
                raw = data["content"][0]["text"].strip()
                # Strip markdown fences if any
                if "```" in raw:
                    parts = raw.split("```")
                    for p in parts:
                        p = p.strip()
                        if p.startswith("json"): p = p[4:]
                        p = p.strip()
                        if p.startswith("["):
                            raw = p; break
                questions = json.loads(raw)
                if isinstance(questions, list) and questions:
                    # Validate: answers must start with letter
                    valid = [q for q in questions if isinstance(q,dict) and q.get("answer","").startswith(letter)]
                    if valid:
                        return valid[:count]
        except Exception:
            if attempt == 0:
                time.sleep(1)

    return make_fallback(letter, count)


def make_fallback(letter: str, count: int) -> list:
    templates = [
        {"text": f"اذكر شخصاً مشهوراً اسمه يبدأ بـ«{letter}»", "answer": f"{letter}...", "hint": "شخصية معروفة عربياً أو عالمياً", "category": "ثقافي", "difficulty": "سهل"},
        {"text": f"اذكر دولة أو مدينة تبدأ بـ«{letter}»", "answer": f"{letter}...", "hint": "موقع جغرافي على الخريطة", "category": "جغرافيا", "difficulty": "سهل"},
        {"text": f"اذكر حيواناً أو نباتاً يبدأ بـ«{letter}»", "answer": f"{letter}...", "hint": "كائن حي من الطبيعة", "category": "علوم", "difficulty": "سهل"},
    ]
    return templates[:count]


if __name__ == "__main__":
    try:
        inp = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
        result = generate(
            letter     = inp.get("letter",     "أ"),
            category   = inp.get("category",   "عشوائي"),
            difficulty = inp.get("difficulty", "متوسط"),
            count      = int(inp.get("count",  3))
        )
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps([{"text":"سؤال عام","answer":"—","hint":"—","category":"عام","difficulty":"سهل"}], ensure_ascii=False))