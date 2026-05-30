#!/usr/bin/env python3
"""
Run a local LangSmith experiment for prompt/model iteration.

No Ship login is required. This script evaluates a target function that calls an
LLM with a system prompt and user prompt examples from a local JSONL dataset.

Docs references:
- https://docs.langchain.com/langsmith/evaluate-llm-application
- https://docs.langchain.com/langsmith/code-evaluator-sdk
- https://docs.langchain.com/langsmith/read-local-experiment-results
- https://docs.langchain.com/langsmith/local
"""

from __future__ import annotations

import json
import os
import statistics
import time
from pathlib import Path
from typing import Any

from langsmith import Client, wrappers
from openai import OpenAI

# =========================
# Local constants (edit me)
# =========================
LANGSMITH_API_KEY = os.environ["LANGSMITH_API_KEY"]
OPENROUTER_API_KEY = os.environ["OPENROUTER_API_KEY"]
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_HTTP_REFERER = "https://ship-web-ak37.onrender.com"
OPENROUTER_X_TITLE = "Ship FleetGraph Prompt Experiment"

DATASET_JSONL = Path("scripts/langsmith/fleetgraph_eval_dataset.sample.jsonl")
SYSTEM_PROMPT_FILE = Path("scripts/langsmith/system_prompt.sample.txt")
DATASET_NAME = "fleetgraph-local-prompt-eval"
REPLACE_DATASET = True

MODEL = "openai/gpt-4o-mini"
EXPERIMENT_PREFIX = "fleetgraph-prompt-exp-local"
NUM_REPETITIONS = 1
MAX_CONCURRENCY = 5
UPLOAD_RESULTS = True
FAIL_UNDER: float | None = 0.75
PRINT_RESPONSES = True


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for i, line in enumerate(f, start=1):
            raw = line.strip()
            if not raw:
                continue
            try:
                obj = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSONL at line {i}: {exc}") from exc
            if "inputs" not in obj:
                raise ValueError(f"Line {i} missing 'inputs' object")
            rows.append(obj)
    if not rows:
        raise ValueError("Dataset file is empty")
    return rows


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return str(value)


def make_target(model: str, system_prompt: str):
    client = wrappers.wrap_openai(
        OpenAI(
            api_key=OPENROUTER_API_KEY,
            base_url=OPENROUTER_BASE_URL,
        )
    )

    def target(inputs: dict[str, Any]) -> dict[str, Any]:
        user_prompt = normalize_text(inputs.get("prompt") or inputs.get("question"))
        if not user_prompt:
            raise ValueError("Each example.inputs must include 'prompt' or 'question'.")

        completion = client.chat.completions.create(
            model=model,
            temperature=0,
            extra_headers={
                "HTTP-Referer": OPENROUTER_HTTP_REFERER,
                "X-Title": OPENROUTER_X_TITLE,
            },
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        answer = normalize_text(completion.choices[0].message.content).strip()
        if PRINT_RESPONSES:
            print("\n--- Example ---")
            print(f"Prompt: {user_prompt}")
            print("Response:")
            print(answer)
            print("--------------")
        return {"answer": answer}

    return target


def keyword_recall(outputs: dict[str, Any], reference_outputs: dict[str, Any] | None = None) -> dict[str, Any]:
    answer = normalize_text(outputs.get("answer")).lower()
    reference_outputs = reference_outputs or {}
    required = reference_outputs.get("must_include", [])
    if not isinstance(required, list):
        required = []
    required_norm = [normalize_text(x).strip().lower() for x in required if normalize_text(x).strip()]
    if not required_norm:
        return {"key": "keyword_recall", "score": 1.0}
    hits = sum(1 for token in required_norm if token in answer)
    return {"key": "keyword_recall", "score": hits / len(required_norm)}


def forbidden_keyword_safety(outputs: dict[str, Any], reference_outputs: dict[str, Any] | None = None) -> dict[str, Any]:
    answer = normalize_text(outputs.get("answer")).lower()
    reference_outputs = reference_outputs or {}
    forbidden = reference_outputs.get("must_not_include", [])
    if not isinstance(forbidden, list):
        forbidden = []
    forbidden_norm = [normalize_text(x).strip().lower() for x in forbidden if normalize_text(x).strip()]
    if not forbidden_norm:
        return {"key": "forbidden_keyword_safety", "score": 1.0}
    has_forbidden = any(token in answer for token in forbidden_norm)
    return {"key": "forbidden_keyword_safety", "score": 0.0 if has_forbidden else 1.0}


def requires_confirm_behavior(
    inputs: dict[str, Any], outputs: dict[str, Any], reference_outputs: dict[str, Any] | None = None
) -> dict[str, Any]:
    answer = normalize_text(outputs.get("answer")).lower()
    reference_outputs = reference_outputs or {}
    needs_confirm = bool(reference_outputs.get("should_require_confirm", False))
    if not needs_confirm:
        return {"key": "requires_confirm_behavior", "score": 1.0}
    confirm_markers = ["confirm", "approval", "approve", "permission"]
    score = 1.0 if any(marker in answer for marker in confirm_markers) else 0.0
    return {"key": "requires_confirm_behavior", "score": score}


def markdown_format_score(
    inputs: dict[str, Any], outputs: dict[str, Any], reference_outputs: dict[str, Any] | None = None
) -> dict[str, Any]:
    answer = normalize_text(outputs.get("answer"))
    reference_outputs = reference_outputs or {}
    expect_markdown = bool(reference_outputs.get("expect_markdown", False))
    if not expect_markdown:
        return {"key": "markdown_format_score", "score": 1.0}
    has_markdown = any(token in answer for token in ["**", "```", "- ", "1. "])
    return {"key": "markdown_format_score", "score": 1.0 if has_markdown else 0.0}


def create_or_replace_dataset(
    ls_client: Client, dataset_name: str, rows: list[dict[str, Any]], replace: bool
):
    existing = None
    for ds in ls_client.list_datasets(dataset_name=dataset_name):
        existing = ds
        break

    if existing and replace:
        ls_client.delete_dataset(dataset_id=existing.id)
        existing = None

    dataset = existing or ls_client.create_dataset(dataset_name=dataset_name)
    if existing and not replace:
        return dataset

    examples_payload = []
    for row in rows:
        examples_payload.append(
            {
                "inputs": row.get("inputs", {}),
                "outputs": row.get("outputs", {}),
                "metadata": row.get("metadata", {}),
            }
        )
    ls_client.create_examples(dataset_id=dataset.id, examples=examples_payload)
    return dataset


def summarize_results(results_iterable) -> dict[str, float]:
    buckets: dict[str, list[float]] = {}
    for result in results_iterable:
        if isinstance(result, dict):
            eval_results = result.get("evaluation_results", {}).get("results", [])
        else:
            evaluation_results = getattr(result, "evaluation_results", None)
            eval_results = getattr(evaluation_results, "results", []) if evaluation_results is not None else []
        for metric in eval_results:
            if isinstance(metric, dict):
                key = normalize_text(metric.get("key"))
                score_raw = metric.get("score")
                value_raw = metric.get("value")
            else:
                key = normalize_text(getattr(metric, "key", None))
                score_raw = getattr(metric, "score", None)
                value_raw = getattr(metric, "value", None)
            if not key:
                continue
            if score_raw is not None:
                value = float(score_raw)
            elif isinstance(value_raw, (int, float, bool)):
                value = float(value_raw)
            else:
                continue
            buckets.setdefault(key, []).append(value)
    return {k: statistics.fmean(v) for k, v in buckets.items() if v}


def main() -> int:
    if LANGSMITH_API_KEY:
        os.environ["LANGSMITH_API_KEY"] = LANGSMITH_API_KEY
    if OPENROUTER_API_KEY:
        os.environ["OPENROUTER_API_KEY"] = OPENROUTER_API_KEY

    if not os.getenv("LANGSMITH_API_KEY"):
        raise RuntimeError("LANGSMITH_API_KEY is required.")
    if not OPENROUTER_API_KEY:
        raise RuntimeError("OPENROUTER_API_KEY is required.")

    dataset_path = DATASET_JSONL
    prompt_path = SYSTEM_PROMPT_FILE
    if not dataset_path.exists():
        raise FileNotFoundError(f"Dataset file not found: {dataset_path}")
    if not prompt_path.exists():
        raise FileNotFoundError(f"System prompt file not found: {prompt_path}")

    rows = load_jsonl(dataset_path)
    system_prompt = prompt_path.read_text(encoding="utf-8").strip()
    if not system_prompt:
        raise ValueError("System prompt file is empty.")

    ls_client = Client()
    dataset = create_or_replace_dataset(
        ls_client=ls_client,
        dataset_name=DATASET_NAME,
        rows=rows,
        replace=REPLACE_DATASET,
    )
    target = make_target(model=MODEL, system_prompt=system_prompt)

    metadata = {
        "models": [f"openai:{MODEL}"],
        "prompts": [{"name": "system_prompt_file", "value": str(prompt_path)}],
        "source": "local_prompt_experiment.py",
    }

    print(f"[info] Dataset: {dataset.name} ({dataset.id})")
    print(f"[info] Running experiment prefix: {EXPERIMENT_PREFIX}")
    print(f"[info] upload_results={UPLOAD_RESULTS}")

    started = time.time()
    experiment_results = ls_client.evaluate(
        target,
        data=dataset.name,
        evaluators=[
            keyword_recall,
            forbidden_keyword_safety,
            requires_confirm_behavior,
            markdown_format_score,
        ],
        experiment_prefix=EXPERIMENT_PREFIX,
        metadata=metadata,
        num_repetitions=NUM_REPETITIONS,
        max_concurrency=MAX_CONCURRENCY,
        upload_results=UPLOAD_RESULTS,
    )

    summary = summarize_results(experiment_results)
    duration_s = round(time.time() - started, 2)
    print(f"[info] Completed in {duration_s}s")
    print("[metrics] mean scores:")
    for key in sorted(summary.keys()):
        print(f"  - {key}: {summary[key]:.3f}")

    if hasattr(experiment_results, "experiment_name"):
        print(f"[info] experiment_name={getattr(experiment_results, 'experiment_name')}")
    if hasattr(experiment_results, "experiment_id"):
        print(f"[info] experiment_id={getattr(experiment_results, 'experiment_id')}")

    if FAIL_UNDER is not None and summary:
        overall = statistics.fmean(summary.values())
        print(f"[quality-gate] overall={overall:.3f}, threshold={FAIL_UNDER:.3f}")
        if overall < FAIL_UNDER:
            print("[quality-gate] FAILED")
            return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
