import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";

export async function handleContent(api: HeartbeatAPI, params: ToolParams): Promise<string> {
  const action = params.action ?? "courses";

  if (action === "courses") {
    const courses = await api.get<unknown[]>("/courses");
    return JSON.stringify({ count: courses.length, courses });
  }

  if (action === "lesson") {
    if (!params.lesson_id) return JSON.stringify({ error: "Required: 'lesson_id'" });
    const lesson = await api.get<Record<string, unknown>>(`/lessons/${params.lesson_id}`);
    return JSON.stringify(lesson);
  }

  if (action === "documents") {
    const queryParams: Record<string, unknown> = {};
    if (params.limit) queryParams.limit = params.limit;
    if (params.document_id) queryParams.startingAfter = params.document_id; // cursor pagination
    const docs = await api.get<unknown[]>("/documents", queryParams);
    return JSON.stringify({ count: docs.length, documents: docs });
  }

  if (action === "document") {
    if (!params.document_id) return JSON.stringify({ error: "Required: 'document_id'" });
    const doc = await api.get<Record<string, unknown>>(`/documents/${params.document_id}`);
    return JSON.stringify(doc);
  }

  if (action === "create_lesson") {
    if (!params.title || !params.content_text) {
      return JSON.stringify({ error: "Required: 'title' and 'content_text'" });
    }
    const body: Record<string, unknown> = {
      title: params.title,
      content: params.content_text,
    };
    if (params.course_id) body.courseID = params.course_id;
    const result = await api.put<Record<string, unknown>>("/lessons", body);
    return JSON.stringify({ action: "lesson_created", lesson: result });
  }

  if (action === "update_lesson") {
    if (!params.lesson_id) return JSON.stringify({ error: "Required: 'lesson_id'" });
    const body: Record<string, unknown> = {};
    if (params.title) body.title = params.title;
    if (params.content_text) body.content = params.content_text;
    const result = await api.post<Record<string, unknown>>(`/lessons/${params.lesson_id}`, body);
    return JSON.stringify({ action: "lesson_updated", lesson: result });
  }

  if (action === "videos") {
    const videos = await api.get<unknown[]>("/videos");
    return JSON.stringify({ count: videos.length, videos });
  }

  return JSON.stringify({ error: `Unknown content action: ${action}. Valid actions: courses, lesson, documents, document, create_lesson, update_lesson, videos` });
}
