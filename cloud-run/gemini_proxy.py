"""
Gemini API 프록시 (Cloud Run / functions_framework)
====================================================
프론트엔드가 Gemini API 키를 보유하지 않도록, 모든 Gemini 호출을 백엔드에서 대행한다.
- 키는 Cloud Run 환경변수 `GEMINI_API_KEY` 로만 주입 → 클라이언트 JS 번들에 절대 노출되지 않음
- 앱 JWT(localStorage `google_drive_jwt`)로 인증된 요청만 허용 (`GEMINI_REQUIRE_AUTH=false` 로 해제 가능)

────────────────────────────────────────────────────────────────────────
기존 백엔드(man.py, functions_framework 단일 함수 + 경로 디스패치)에 통합하는 방법
────────────────────────────────────────────────────────────────────────
  1) requirements.txt 에 추가:
         google-genai
         PyJWT          # (이미 있으면 생략)
  2) Cloud Run 환경변수 설정:
         GEMINI_API_KEY=<새로 발급한 Gemini 키>     # ⚠️ 기존 유출 키 말고 새 키
         JWT_SECRET=<기존 인증과 동일한 값>
         # (선택) GEMINI_REQUIRE_AUTH=false  → 비로그인 사용 허용
  3) man.py 의 경로 디스패치에 한 줄 추가:
         from gemini_proxy import handle_gemini
         path = request.path or ''
         if path.startswith('/gemini'):
             return handle_gemini(request)
  4) 또는 이 파일을 독립 함수로 배포 (entry-point: gemini_proxy)

⚠️ `_verify_jwt` 는 HS256 + `JWT_SECRET` 가정이다. 기존 `/auth/refresh` 의 JWT 검증
   방식과 다르면 그 함수로 교체할 것 (알고리즘/claim 일치).

엔드포인트:
  POST /gemini          body {"prompt": str, "search": bool}  -> {"text": str}
  POST /gemini/stream   body {"prompt": str}                  -> text/plain 스트리밍
"""
import os
import json

import functions_framework
from flask import Response
import jwt  # PyJWT
from google import genai
from google.genai import types

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
JWT_SECRET = os.environ.get("JWT_SECRET", "")
REQUIRE_AUTH = os.environ.get("GEMINI_REQUIRE_AUTH", "true").lower() != "false"
MODEL = "gemini-2.5-flash"

# CORS 허용 오리진 — 배포 도메인에 맞게 조정
ALLOWED_ORIGINS = {
    "https://kimwonjong75.github.io",
    "http://localhost:3000",
    "http://localhost:5173",
}

_client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None


def _cors_headers(request):
    origin = request.headers.get("Origin", "")
    allow = origin if origin in ALLOWED_ORIGINS else ""
    return {
        "Access-Control-Allow-Origin": allow or "null",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "3600",
    }


def _verify_jwt(request):
    """앱 JWT 검증. 통과 시 payload, 실패 시 None. (REQUIRE_AUTH=false면 무조건 통과)"""
    if not REQUIRE_AUTH:
        return {"sub": "anonymous"}
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:]
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except Exception:
        return None


def _generate(prompt: str, search: bool) -> str:
    config = None
    if search:
        config = types.GenerateContentConfig(
            tools=[types.Tool(google_search=types.GoogleSearch())]
        )
    resp = _client.models.generate_content(model=MODEL, contents=prompt, config=config)
    return (resp.text or "").strip()


def handle_gemini(request):
    headers = _cors_headers(request)

    if request.method == "OPTIONS":
        return ("", 204, headers)

    if _client is None:
        return (json.dumps({"error": "GEMINI_API_KEY not configured"}), 500,
                {**headers, "Content-Type": "application/json"})

    if _verify_jwt(request) is None:
        return (json.dumps({"error": "Unauthorized"}), 401,
                {**headers, "Content-Type": "application/json"})

    body = request.get_json(silent=True) or {}
    prompt = body.get("prompt", "")
    if not prompt:
        return (json.dumps({"error": "Missing prompt"}), 400,
                {**headers, "Content-Type": "application/json"})

    # 스트리밍 엔드포인트: /gemini/stream
    path = (request.path or "").rstrip("/")
    if path.endswith("/stream"):
        def stream():
            try:
                for chunk in _client.models.generate_content_stream(
                    model=MODEL, contents=prompt
                ):
                    if chunk.text:
                        yield chunk.text
            except Exception as e:  # noqa: BLE001
                yield f"\n[stream error] {e}"

        return Response(
            stream(),
            mimetype="text/plain; charset=utf-8",
            headers=headers,
        )

    # 일반 엔드포인트: /gemini
    try:
        text = _generate(prompt, bool(body.get("search")))
        return (json.dumps({"text": text}), 200,
                {**headers, "Content-Type": "application/json"})
    except Exception as e:  # noqa: BLE001
        return (json.dumps({"error": str(e)}), 502,
                {**headers, "Content-Type": "application/json"})


@functions_framework.http
def gemini_proxy(request):
    """독립 배포용 엔트리포인트."""
    return handle_gemini(request)
