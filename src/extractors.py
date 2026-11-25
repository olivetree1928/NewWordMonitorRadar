"""从推文文本中提取视频/图片/世界模型相关新词。"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


# 常见厂商/产品前缀，帮助抓「Brand + Version」
BRAND_HINTS = (
    r"Kling|Veo|Sora|Flux|FLUX|Seedream|Seedance|Wan|Runway|Gen(?:-\d)?|"
    r"Pika|Luma|Dream\s?Machine|Hailuo|MiniMax|H3|Gemini\s?Omni|Omni|"
    r"Genie|Grok\s?Imagine|Firefly|Ideogram|Midjourney|MJ|"
    r"GPT[\s-]?Image|Images?|Nano\s?Banana|Stable\s?Diffusion|SD\d|"
    r"Imagen|DALL[·\-]?E|CogVideo|Vidu|PixVerse|Haiper|Mochi|"
    r"Hunyuan|SkyReels|LTX|Cosmos"
)

# 版本号片段：4.0 / 1.2 / V7 / Gen-4.5 / Flash / Max / Prime
VERSION_HINT = (
    r"(?:V?\d+(?:\.\d+){0,2}|Gen[-\s]?\d+(?:\.\d+)?|"
    r"Flash|Max|Pro|Prime|Ultra|Turbo|Lite|Mini|Flex|Sunburst|Flare|Klein)"
)

MODEL_PATTERN = re.compile(
    rf"""
    \b
    (
      (?:{BRAND_HINTS})
      (?:[\s\-/]*(?:{VERSION_HINT})){{0,3}}
    )
    \b
    """,
    re.IGNORECASE | re.VERBOSE,
)

# 明确「发布/上线」语境，降低噪音
LAUNCH_CONTEXT = re.compile(
    r"\b(releas(?:e|ed|ing)|launch(?:ed|ing)?|announc(?:e|ed|ing)|"
    r"available|GA\b|generally available|now live|shipping|introducing|"
    r"推出|发布|上线|开源)\b",
    re.IGNORECASE,
)

CATEGORY_RULES: list[tuple[str, re.Pattern[str]]] = [
    (
        "video",
        re.compile(
            r"\b(video|text-to-video|image-to-video|t2v|i2v|clip|短剧|视频)\b",
            re.I,
        ),
    ),
    (
        "image",
        re.compile(
            r"\b(image|img|text-to-image|t2i|picture|photo|图片|生图)\b",
            re.I,
        ),
    ),
    (
        "world",
        re.compile(r"\b(world\s?model|interactive world|Genie|仿真世界)\b", re.I),
    ),
]


@dataclass
class ExtractedTerm:
    name: str
    category: str
    source_handle: str = ""
    tweet_id: str = ""
    tweet_url: str = ""
    tweet_text: str = ""
    created_at: str = ""
    confidence: str = "medium"  # high | medium | low
    tags: list[str] = field(default_factory=list)


def _normalize(name: str) -> str:
    name = re.sub(r"\s+", " ", name.strip())
    # 统一常见写法
    replacements = {
        r"(?i)^flux\b": "FLUX",
        r"(?i)^gpt[\s-]?image": "GPT Image",
        r"(?i)^mj\b": "Midjourney",
        r"(?i)^genie4\b": "Genie 4",
        r"(?i)^kling4": "Kling 4",
    }
    for pat, repl in replacements.items():
        name = re.sub(pat, repl, name)
    return name


def _guess_category(text: str, name: str) -> str:
    blob = f"{name} {text}"
    for category, pattern in CATEGORY_RULES:
        if pattern.search(blob):
            return category
    # 名称自带线索
    lower = name.lower()
    if "genie" in lower:
        return "world"
    if any(k in lower for k in ("kling", "veo", "sora", "pika", "runway", "wan", "omni", "seedance", "hailuo")):
        return "video"
    if any(k in lower for k in ("seedream", "flux", "ideogram", "midjourney", "imagen", "dall", "gpt image", "nano banana")):
        return "image"
    return "unknown"


def extract_from_text(
    text: str,
    *,
    source_handle: str = "",
    tweet_id: str = "",
    created_at: str = "",
) -> list[ExtractedTerm]:
    if not text:
        return []

    has_launch = bool(LAUNCH_CONTEXT.search(text))
    found: dict[str, ExtractedTerm] = {}

    for match in MODEL_PATTERN.finditer(text):
        raw = match.group(1)
        name = _normalize(raw)
        if len(name) < 3:
            continue
        # 过短或纯品牌无版本，且无发布语境 → 降权跳过噪音
        if not re.search(r"\d|Flash|Max|Prime|Flex|Turbo|Sunburst|Flare|Klein", name, re.I):
            if not has_launch:
                continue

        key = name.lower()
        if key in found:
            continue

        category = _guess_category(text, name)
        confidence = "high" if has_launch else "medium"
        url = f"https://x.com/{source_handle}/status/{tweet_id}" if source_handle and tweet_id else ""

        found[key] = ExtractedTerm(
            name=name,
            category=category,
            source_handle=source_handle,
            tweet_id=tweet_id,
            tweet_url=url,
            tweet_text=text[:280],
            created_at=created_at,
            confidence=confidence,
        )

    return list(found.values())


def flatten_known_names(known: dict) -> set[str]:
    """把 known_models.yaml 展平为小写名称+别名集合。"""
    names: set[str] = set()
    for category, items in known.items():
        if category.startswith("_") or not isinstance(items, list):
            continue
        for item in items:
            names.add(item["name"].lower())
            for alias in item.get("aliases") or []:
                names.add(str(alias).lower())
    return names


def is_new_term(name: str, known_names: set[str]) -> bool:
    n = name.lower().strip()
    if n in known_names:
        return False
    # 宽松包含：已知「Kling 4.0」则「Kling 4.0 Omni」不算全新品类时可按需调整
    for known in known_names:
        if n == known or n.startswith(known + " ") or known.startswith(n + " "):
            return False
    return True