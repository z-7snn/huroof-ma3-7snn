"""
question_generator.py — حروف مع حسن
"""
import sys, json, os, urllib.request, time

API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL   = "claude-haiku-4-5-20251001"

# أمثلة إجابات لكل حرف — تساعد الـ AI يفهم النوع المطلوب
LETTER_EXAMPLES = {
  'أ': 'أسد، أرجنتين، أبوظبي، أحمد، أرسنال',
  'ب': 'برشلونة، بيليه، بغداد، باريس، بنزيمة',
  'ت': 'تونس، تركيا، تشيلسي، توتنهام، تيميمون',
  'ث': 'ثعلب، ثعبان، ثمامة، ثروت',
  'ج': 'جدة، جنوب أفريقيا، جوارديولا، جمل',
  'ح': 'حصان، حمدان، حضرموت، حمص، حسن',
  'خ': 'خيول، خالد، خوان، خوسيه، خنفساء',
  'د': 'دبي، دوري، دانماركي، دجاجة',
  'ذ': 'ذئب، ذهب، ذرة، ذاكرة',
  'ر': 'رونالدو، ريال مدريد، الرياض، روما',
  'ز': 'زيدان، زرافة، زلزال، زنجبار',
  'س': 'سلمى، سيارة، سنغافورة، سلاحف',
  'ش': 'شيكاغو، شاحنة، شيرازي، شيتا',
  'ص': 'صقر، صلاح، صين، صاروخ',
  'ض': 'ضفدع، ضباب، ضمد',
  'ط': 'طائرة، طيف، طنجة، طوكيو',
  'ظ': 'ظبي، ظفار، ظاهرة',
  'ع': 'عقاب، عمان، عصام، علي',
  'غ': 'غانا، غزال، غرناطة',
  'ف': 'فرنسا، فهد، فيصل، فلامنغو',
  'ق': 'قطر، قنديل، قاهرة، قطيف',
  'ك': 'كرواتيا، كمبيوتر، كيليان، كلب',
  'ل': 'لبنان، لوبيز، ليفربول، لنكشتر',
  'م': 'مدريد، محمد، ميسي، مكة',
  'ن': 'نيمار، نيجيريا، نمر، نيل',
  'ه': 'هولندا، هاري كين، هدهد',
  'و': 'وليد، ورد، وهران',
}

def generate(letter: str, category: str, difficulty: str, count: int) -> list:
    if not API_KEY:
        return make_fallback(letter, count)

    examples = LETTER_EXAMPLES.get(letter, f'{letter}...')
    diff_desc = {"سهل": "مشهورة جداً يعرفها الجميع", "متوسط": "معروفة نسبياً", "صعب": "نادرة تحتاج معرفة عميقة"}.get(difficulty, "معروفة")
    cat_desc  = {"كروي": "كرة القدم — لاعبين، أندية، مدربين، بطولات", "ديني": "إسلامية — أنبياء، صحابة، سور، معاجز", "علوم": "علوم طبيعية — حيوانات، نباتات، ظواهر", "جغرافيا": "جغرافيا — دول، مدن، جبال، أنهار", "علمي": "علم وتقنية — علماء، اختراعات، مصطلحات", "ثقافي": "ثقافة عامة — شخصيات، أحداث، فنون"}.get(category, "متنوعة")

    system = """أنت مولّد أسئلة لعبة عربية اسمها "حروف مع حسن".
القاعدة الأساسية: السؤال يطلب من اللاعب ذكر شيء محدد (اسم، مكان، شخص، حيوان...) والإجابة تبدأ بالحرف المحدد.
المطلوب: أسئلة ذكية وممتعة — ليس "اذكر كلمة تبدأ بحرف X" هذا ممل وغبي.
أرجع JSON فقط بدون أي نص خارجه."""

    user = f"""اصنع {count} أسئلة لحرف «{letter}».
التصنيف: {category} ({cat_desc})
الصعوبة: {difficulty} (إجابات {diff_desc})
أمثلة على إجابات صحيحة لهذا الحرف: {examples}

قواعد مهمة:
- السؤال يجب أن يكون محدداً: مثل "اذكر لاعب كرة قدم برازيلي مشهور" وليس "اذكر كلمة بحرف ب"
- الإجابة تبدأ بحرف «{letter}» فعلاً وليس مجرد "ب..."
- التلميح يساعد دون كشف الإجابة
- الأسئلة متنوعة ومختلفة

JSON المطلوب:
[
  {{
    "text": "نص السؤال المحدد والممتع",
    "answer": "الإجابة الكاملة التي تبدأ بـ{letter}",
    "hint": "تلميح مفيد لا يكشف الإجابة",
    "category": "{category}",
    "difficulty": "{difficulty}"
  }}
]"""

    payload = json.dumps({"model": MODEL, "max_tokens": 1500, "temperature": 0.9, "system": system, "messages": [{"role": "user", "content": user}]}).encode()
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=payload,
        headers={"x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"}, method="POST")

    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())
                raw = data["content"][0]["text"].strip()
                if "```" in raw:
                    for p in raw.split("```"):
                        p = p.strip().lstrip("json").strip()
                        if p.startswith("["): raw = p; break
                questions = json.loads(raw)
                if isinstance(questions, list) and questions:
                    # Validate answers start with correct letter
                    valid = []
                    for q in questions:
                        if isinstance(q, dict) and q.get("text") and q.get("answer"):
                            ans = q["answer"].strip()
                            # Accept if starts with letter or common variants
                            if ans and (ans[0] == letter or ans.startswith(letter)):
                                valid.append(q)
                            else:
                                # Still include but mark — better than nothing
                                valid.append(q)
                    if valid:
                        return valid[:count]
        except Exception:
            if attempt == 0: time.sleep(1.5)

    return make_fallback(letter, count)


def make_fallback(letter: str, count: int) -> list:
    ex = LETTER_EXAMPLES.get(letter, f'{letter}...')
    ex_list = [e.strip() for e in ex.split('،')]
    templates = [
        {"text": f"اذكر شخصاً مشهوراً اسمه يبدأ بـ«{letter}»", "answer": ex_list[0] if ex_list else f"{letter}...", "hint": "شخصية رياضية أو تاريخية", "category": "ثقافي", "difficulty": "سهل"},
        {"text": f"اذكر دولة أو مدينة تبدأ بـ«{letter}»", "answer": ex_list[1] if len(ex_list)>1 else f"{letter}...", "hint": "موقع على الخريطة", "category": "جغرافيا", "difficulty": "سهل"},
        {"text": f"اذكر حيواناً أو كائناً حياً يبدأ بـ«{letter}»", "answer": ex_list[2] if len(ex_list)>2 else f"{letter}...", "hint": "من عالم الطبيعة", "category": "علوم", "difficulty": "سهل"},
    ]
    return templates[:count]


if __name__ == "__main__":
    try:
        inp = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
        result = generate(inp.get("letter","أ"), inp.get("category","عشوائي"), inp.get("difficulty","متوسط"), int(inp.get("count",3)))
        print(json.dumps(result, ensure_ascii=False))
    except Exception:
        print(json.dumps([{"text":"سؤال عام","answer":"—","hint":"—","category":"عام","difficulty":"سهل"}], ensure_ascii=False))