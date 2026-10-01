"""MCP Apps resources and schemas for LifeOS generative UI."""

from __future__ import annotations

from importlib.resources import files
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

DAY_PLAN_RESOURCE_URI = "ui://lifeos/day-plan-v3.html"
DAY_PLAN_RESOURCE_MIME = "text/html;profile=mcp-app"
WEEK_PLAN_RESOURCE_URI = "ui://lifeos/week-plan-v1.html"
WEEK_PLAN_RESOURCE_MIME = "text/html;profile=mcp-app"
PROPOSAL_REVIEW_RESOURCE_URI = "ui://lifeos/proposal-review-v1.html"
PROPOSAL_REVIEW_RESOURCE_MIME = "text/html;profile=mcp-app"
BRAIN_DUMP_CANVAS_RESOURCE_URI = "ui://lifeos/brain-dump-canvas-v4.html"
BRAIN_DUMP_CANVAS_LEGACY_RESOURCE_URI = "ui://lifeos/brain-dump-canvas-v1.html"
BRAIN_DUMP_CANVAS_V2_RESOURCE_URI = "ui://lifeos/brain-dump-canvas-v2.html"
BRAIN_DUMP_CANVAS_V3_RESOURCE_URI = "ui://lifeos/brain-dump-canvas-v3.html"
BRAIN_DUMP_CANVAS_RESOURCE_MIME = "text/html;profile=mcp-app"
MEMORY_REVIEW_RESOURCE_URI = "ui://lifeos/memory-review-v1.html"
MEMORY_REVIEW_RESOURCE_MIME = "text/html;profile=mcp-app"


class DayPlanBlockView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    start: str
    end: str
    duration_minutes: int = Field(ge=1)
    part: int = Field(default=1, ge=1)
    calendar_id: str = Field(min_length=1)


class UnscheduledTaskView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    reason: str = Field(min_length=1)
    remaining_minutes: int = Field(ge=1)


class DayPlanWidgetOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    day_start: str
    day_end: str
    blocks: list[DayPlanBlockView]
    unscheduled: list[UnscheduledTaskView] = Field(default_factory=list)
    proposal_ready: bool = True
    mutates_external_systems: bool = False


class WeekPlanDayView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    day_start: str
    day_end: str
    blocks: list[DayPlanBlockView] = Field(default_factory=list)


class WeekPlanWidgetOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    range_start: str
    range_end: str
    days: list[WeekPlanDayView] = Field(min_length=1, max_length=14)
    unscheduled: list[UnscheduledTaskView] = Field(default_factory=list)
    proposal_ready: bool = True
    mutates_external_systems: bool = False


class ProposalSourceSnapshotView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    system: Literal["things", "calendar_range"]
    record_id: str = Field(min_length=1)
    version: str | None = None
    data: dict[str, object] = Field(default_factory=dict)


class ProposalThingsChangeView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation: Literal["create", "update", "complete", "cancel"]
    task_id: str | None = None
    fields: dict[str, object] = Field(default_factory=dict)
    destructive: bool = False


class ProposalCalendarChangeView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation: Literal["create", "update", "delete"]
    calendar_id: str = Field(min_length=1)
    event_id: str | None = None
    fields: dict[str, object] = Field(default_factory=dict)
    destructive: bool = False


class ProposalReviewOutput(BaseModel):
    """One immutable proposal revision shown for explicit review."""

    model_config = ConfigDict(extra="forbid")

    proposal_id: str = Field(min_length=1)
    revision_number: int = Field(ge=1)
    revision_hash: str = Field(min_length=1)
    state: Literal[
        "draft",
        "approved",
        "applying",
        "applied",
        "partial_failure",
        "stale",
        "rejected",
        "reverted",
    ]
    source_snapshots: list[ProposalSourceSnapshotView] = Field(default_factory=list)
    things_changes: list[ProposalThingsChangeView] = Field(default_factory=list)
    calendar_changes: list[ProposalCalendarChangeView] = Field(default_factory=list)
    created_at: str
    approved_revision_hash: str | None = None
    failure_detail: str | None = None


class CanvasItemView(BaseModel):
    """One piece of interpreted content inside a canvas node."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=500)
    detail: str | None = Field(default=None, max_length=10_000)
    meta: str | None = Field(default=None, max_length=500)
    area: str | None = Field(default=None, max_length=200)
    project: str | None = Field(default=None, max_length=500)
    start: str | None = Field(default=None, max_length=100)
    end: str | None = Field(default=None, max_length=100)
    time_expression: str | None = Field(default=None, max_length=500)
    source_excerpt: str | None = Field(default=None, max_length=2_000)
    assignee: str | None = Field(default=None, max_length=200)
    evidence_status: Literal["confirmed", "notes_only", "conflict", "inference"] | None = None
    state: Literal["candidate", "scheduled", "unscheduled", "unresolved", "saved"] = "candidate"


class TranscriptSegmentView(BaseModel):
    """One timestamped speaker turn shown in a meeting debrief."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=120)
    speaker: str = Field(min_length=1, max_length=200)
    timestamp: str | None = Field(default=None, max_length=40)
    text: str = Field(min_length=1, max_length=10_000)
    is_user: bool = False


class CanvasNodeView(BaseModel):
    """A model-positioned region in the responsive twelve-column canvas."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=120)
    kind: Literal[
        "tasks",
        "calendar",
        "journal",
        "questions",
        "note",
        "heading",
        "mermaid",
        "custom_html",
    ]
    title: str = Field(min_length=1, max_length=500)
    body: str | None = Field(default=None, max_length=20_000)
    items: list[CanvasItemView] = Field(default_factory=list, max_length=40)
    accent: Literal["neutral", "blue", "green", "plum", "amber"] = "neutral"
    x: int = Field(default=1, ge=1, le=12, description="Legacy placement hint; source order wins.")
    y: int = Field(default=1, ge=1, le=200, description="Sort-order hint, not a pixel position.")
    width: int = Field(
        default=12,
        ge=1,
        le=12,
        description="Number of columns to span, from 1 to 12.",
    )
    min_height: int = Field(
        default=2,
        ge=1,
        le=2_000,
        description=(
            "Legacy minimum-height hint. Compact row values and older pixel-style values are both "
            "accepted, but the renderer always expands the node to fit its content."
        ),
    )
    html: str | None = Field(
        default=None,
        max_length=40_000,
        description="HTML for custom_html nodes. It runs only inside an isolated nested sandbox.",
    )
    css: str | None = Field(
        default=None,
        max_length=30_000,
        description="CSS for a custom_html node's isolated document.",
    )
    javascript: str | None = Field(
        default=None,
        max_length=30_000,
        description=(
            "Optional JavaScript for a custom_html node. It runs in a unique-origin sandbox "
            "with network, navigation, popups, storage, and the LifeOS bridge unavailable."
        ),
    )
    diagram: str | None = Field(
        default=None,
        max_length=20_000,
        description=(
            "Mermaid diagram source for mermaid nodes. Prefer flowchart, mindmap, timeline, "
            "or journey syntax. Frontmatter configuration is ignored by the renderer. Add a "
            "plain-language relationship summary in body so the diagram is accessible."
        ),
    )

    @model_validator(mode="after")
    def validate_placement_and_custom_content(self) -> CanvasNodeView:
        if self.x + self.width - 1 > 12:
            raise ValueError("canvas node extends past column 12")
        if self.kind == "custom_html" and not (self.html or self.css or self.javascript):
            raise ValueError("custom_html nodes need html, css, or javascript")
        if self.kind != "custom_html" and any((self.html, self.css, self.javascript)):
            raise ValueError("html, css, and javascript are only valid for custom_html nodes")
        if self.kind == "mermaid" and not self.diagram:
            raise ValueError("mermaid nodes need diagram source")
        if self.kind != "mermaid" and self.diagram:
            raise ValueError("diagram is only valid for mermaid nodes")
        return self


class BrainDumpCanvasOutput(BaseModel):
    """A flexible visual preview composed by an agent from durable LifeOS data."""

    model_config = ConfigDict(extra="forbid")

    version: Literal["1"] = "1"
    title: str = Field(min_length=1, max_length=500)
    subtitle: str | None = Field(default=None, max_length=2_000)
    capture_id: str | None = Field(default=None, max_length=120)
    revision_hash: str | None = Field(default=None, max_length=200)
    source_label: str | None = Field(default=None, max_length=200)
    meeting_date: str | None = Field(default=None, max_length=100)
    participants: list[str] = Field(default_factory=list, max_length=40)
    transcript_segments: list[TranscriptSegmentView] = Field(default_factory=list, max_length=500)
    nodes: list[CanvasNodeView] = Field(min_length=1, max_length=24)
    mutates_external_systems: Literal[False] = False

    @model_validator(mode="after")
    def validate_unique_ids(self) -> BrainDumpCanvasOutput:
        node_ids = [node.id for node in self.nodes]
        if len(node_ids) != len(set(node_ids)):
            raise ValueError("canvas node ids must be unique")
        return self


class MemoryClaimView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    memory_id: str
    text: str
    review_status: Literal["unreviewed"] = "unreviewed"


class MemoryReviewOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    capture_id: str
    source_hash: str
    raw_text: str
    status: str
    claims: list[MemoryClaimView]
    content_is_untrusted: Literal[True] = True


def day_plan_html() -> str:
    """Load the versioned, self-contained ChatGPT component."""
    return files("lifeos").joinpath("ui/day-plan-v1.html").read_text(encoding="utf-8")


def week_plan_html() -> str:
    """Load the versioned multi-day ChatGPT component."""
    return files("lifeos").joinpath("ui/week-plan-v1.html").read_text(encoding="utf-8")


def proposal_review_html() -> str:
    """Load the versioned proposal-review ChatGPT component."""
    return files("lifeos").joinpath("ui/proposal-review-v1.html").read_text(encoding="utf-8")


def brain_dump_canvas_html() -> str:
    """Load the versioned, self-contained brain-dump canvas component."""
    return files("lifeos").joinpath("ui/brain-dump-canvas-v3.html").read_text(encoding="utf-8")


def memory_review_html() -> str:
    return files("lifeos").joinpath("ui/memory-review-v1.html").read_text(encoding="utf-8")
