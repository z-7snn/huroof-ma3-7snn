"""
question_generator.py — حروف مع حسن
يقبل حرفاً واحداً أو قائمة حروف كاملة (للتوليد المسبق)
يُستدعى من server.js عبر spawn واحد فقط
"""
import sys, json, os, urllib.request, time

API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL   = "claude-sonnet-4-6"

LETTER_EXAMPLES = {
  'أ':'أسد، أرجنتين، أبوظبي، أحمد، أرسنال',
  'ب':'برشلونة، بيليه، بغداد، باريس، بنزيمة',
  'ت':'تونس، تركيا، تشيلسي، توتنهام',
  'ث':'ثعلب، ثعبان، ثروت',
  'ج':'جدة، جنوب أفريقيا، جوارديولا، جمل',
  'ح':'حصان، حمدان، حضرموت، حمص',
  'خ':'خيول، خالد، خوان كارلوس',
  'د':'دبي، دوري أبطال، دانمارك',
  'ذ':'ذئب، ذهب، ذرة',
  'ر':'رونالدو، ريال مدريد، الرياض',
  'ز':'زيدان، زرافة، زلزال',
  'س':'سلمى، سنغافورة، سلاحف',
  'ش':'شيكاغو، شيرازي، شيتا',
  'ص':'صقر، صلاح، الصين',
  'ض':'ضفدع، ضباب، ضمد',
  'ط':'طائرة، طنجة، طوكيو',
  'ظ':'ظبي، ظفار، ظاهرة طبيعية',
  'ع':'عقاب، عمان، عصام',
  'غ':'غانا، غزال، غرناطة',
  'ف':'فرنسا، فهد، فلامنغو',
  'ق':'قطر، قاهرة، قطيف',
  'ك':'كرواتيا، كيليان مبابي، كلب',
  'ل':'لبنان، ليفربول، لوبيز',
  'م':'مدريد، محمد، ميسي، مكة',
  'ن':'نيمار، نيجيريا، نمر',
  'ه':'هولندا، هاري كين، هدهد',
  'و':'وليد، وهران، ورد',
}

CAT_DESC  = {'كروي':'كرة القدم: لاعبون، أندية، مدربون، بطولات','ديني':'إسلامية: أنبياء، صحابة، سور، أحداث','علوم':'طبيعية: حيوانات، نباتات، ظواهر','جغرافيا':'جغرافيا: دول، مدن، جبال، أنهار','علمي':'علم وتقنية: علماء، اختراعات، مصطلحات','ثقافي':'ثقافة عامة: شخصيات، أحداث، فنون','عشوائي':'متنوع من جميع المجالات'}
DIFF_DESC = {'سهل':'مشهورة جداً يعرفها الجميع','متوسط':'معروفة نسبياً','صعب':'نادرة تحتاج معرفة عميقة'}

def build_prompt(letter, category, difficulty, count):
    ex = LETTER_EXAMPLES.get(letter, letter+'...')
    cat_d  = CAT_DESC.get(category,  'متنوع')
    diff_d = DIFF_DESC.get(difficulty,'معروفة')
    return f"""اصنع {count} أسئلة لحرف «{letter}».
التصنيف: {category} ({cat_d})
الصعوبة: {difficulty} (إجابات {diff_d})
أمثلة إجابات صحيحة لهذا الحرف: {ex}

قواعد صارمة جداً (Strict Rules):
1. الإجابة (answer) يجب أن تبدأ حصرياً بحرف «{letter}». لا تقبل أي استثناءات.
2. السؤال (text) يجب أن يكون دقيقاً ومباشراً (مثال: "نجم كرة قدم أرجنتيني" وليس "اذكر كلمة").
3. التلميح (hint) يجب ألا يحتوي على الإجابة أو الحرف الأول منها.
4. الإخراج يجب أن يكون مصفوفة JSON صالحة (Valid JSON Array) فقط، بدون أي نصوص إضافية، وبدون علامات Markdown مثل ```json.

التنسيق المطلوب:
[
  {{
    "text": "السؤال",
    "answer": "الإجابة (تبدأ بـ{letter})",
    "hint": "التلميح",
    "category": "{category}",
    "difficulty": "{difficulty}"
  }}
]"""

def call_api(user_prompt, retries=2):
    if not API_KEY:
        return None
    system = "أنت مولّد أسئلة لعبة عربية. أرجع JSON فقط بدون أي نص آخر."
    payload = json.dumps({
        "model": MODEL, "max_tokens": 1500, "temperature": 0.85,
        "system": system,
        "messages": [{"role":"user","content": user_prompt}]
    }).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=payload,
        headers={"x-api-key":API_KEY,"anthropic-version":"2023-06-01","content-type":"application/json"},
        method="POST")
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())
                raw = data["content"][0]["text"].strip()
                # Strip markdown fences
                if "```" in raw:
                    for p in raw.split("```"):
                        p = p.strip().lstrip("json").strip()
                        if p.startswith("["): raw=p; break
                return json.loads(raw)
        except Exception:
            if attempt < retries-1: time.sleep(1.5)
    return None

def make_fallback(letter, count):
    ex = [e.strip() for e in LETTER_EXAMPLES.get(letter, letter+'...').split('،')]
    return [
        {"text":f"اذكر شخصاً مشهوراً اسمه يبدأ بـ«{letter}»","answer":ex[0] if ex else letter+'...', "hint":"شخصية رياضية أو تاريخية","category":"ثقافي","difficulty":"سهل"},
        {"text":f"اذكر دولة أو مدينة تبدأ بـ«{letter}»","answer":ex[1] if len(ex)>1 else letter+'...', "hint":"موقع جغرافي","category":"جغرافيا","difficulty":"سهل"},
        {"text":f"اذكر حيواناً يبدأ بـ«{letter}»","answer":ex[2] if len(ex)>2 else letter+'...', "hint":"كائن حي","category":"علوم","difficulty":"سهل"},
    ][:count]

def generate_one(letter, category, difficulty, count):
    prompt = build_prompt(letter, category, difficulty, count)
    result = call_api(prompt)
    if isinstance(result, list) and result:
        valid = [q for q in result if isinstance(q,dict) and q.get("answer","").strip().startswith(letter)]
        return (valid or result)[:count]
    return make_fallback(letter, count)

def generate_batch(letters_list, category, difficulty, count_each):
    """توليد جماعي — كل الحروف في استدعاءات متوازية (sequential لتجنب rate limit)"""
    output = {}
    for letter in letters_list:
        output[letter] = generate_one(letter, category, difficulty, count_each)
        time.sleep(0.3)  # تجنب rate limiting
    return output

if __name__ == "__main__":
    try:
        inp = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}

        # Batch mode: {"letters":["أ","ب",...], "category":"...", "difficulty":"...", "count":3}
        if "letters" in inp:
            result = generate_batch(inp["letters"], inp.get("category","عشوائي"), inp.get("difficulty","متوسط"), int(inp.get("count",3)))
            print(json.dumps(result, ensure_ascii=False))
        else:
            # Single mode: {"letter":"أ", ...}
            result = generate_one(inp.get("letter","أ"), inp.get("category","عشوائي"), inp.get("difficulty","متوسط"), int(inp.get("count",3)))
            print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps([{"text":"سؤال عام","answer":"—","hint":"—","category":"عام","difficulty":"سهل"}], ensure_ascii=False))