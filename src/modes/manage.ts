import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";

export async function handleManage(api: HeartbeatAPI, params: ToolParams): Promise<string> {
  const action = params.action;
  if (!action) {
    return JSON.stringify({
      error: "Required: 'action'. Valid actions: create_user, update_user, delete_user, reactivate_user, create_pending_user, create_group, update_group, delete_group, add_to_group, remove_from_group, create_channel, update_channel, delete_channel, create_channel_category, update_channel_category, delete_channel_category, list_invitations, create_invitation, update_invitation, list_webhooks, create_webhook, delete_webhook, create_voice_channel, update_voice_channel, list_roles, list_offers, list_signup_pages",
    });
  }

  // ---- User actions ----

  if (action === "create_user") {
    if (!params.email || !params.name) {
      return JSON.stringify({ error: "Required: 'email' and 'name'" });
    }
    const body: Record<string, unknown> = { email: params.email, name: params.name };
    if (params.updates) Object.assign(body, params.updates);
    const result = await api.put<Record<string, unknown>>("/users", body);
    return JSON.stringify({ action: "user_created", user: result });
  }

  if (action === "update_user") {
    if (!params.user_id) return JSON.stringify({ error: "Required: 'user_id'" });
    const body: Record<string, unknown> = { userID: params.user_id };
    if (params.name) body.name = params.name;
    if (params.email) body.email = params.email;
    if (params.updates) Object.assign(body, params.updates);
    const result = await api.post<Record<string, unknown>>("/users", body);
    return JSON.stringify({ action: "user_updated", user: result });
  }

  if (action === "delete_user") {
    if (!params.user_id) return JSON.stringify({ error: "Required: 'user_id'" });
    await api.delete(`/users/${params.user_id}`);
    return JSON.stringify({ action: "user_deleted", user_id: params.user_id });
  }

  if (action === "reactivate_user") {
    if (!params.user_id) return JSON.stringify({ error: "Required: 'user_id'" });
    const result = await api.post<Record<string, unknown>>("/users/reactivate", { userID: params.user_id });
    return JSON.stringify({ action: "user_reactivated", user: result });
  }

  if (action === "create_pending_user") {
    if (!params.email) return JSON.stringify({ error: "Required: 'email'" });
    const body: Record<string, unknown> = { email: params.email };
    if (params.name) body.name = params.name;
    if (params.updates) Object.assign(body, params.updates);
    const result = await api.put<Record<string, unknown>>("/pendingUser", body);
    return JSON.stringify({ action: "pending_user_created", user: result });
  }

  // ---- Group actions ----

  if (action === "create_group") {
    if (!params.name) return JSON.stringify({ error: "Required: 'name'" });
    const body: Record<string, unknown> = { name: params.name };
    if (params.updates) Object.assign(body, params.updates);
    const result = await api.put<Record<string, unknown>>("/groups", body);
    return JSON.stringify({ action: "group_created", group: result });
  }

  if (action === "update_group") {
    if (!params.group_id) return JSON.stringify({ error: "Required: 'group_id'" });
    const body: Record<string, unknown> = {};
    if (params.name) body.name = params.name;
    if (params.updates) Object.assign(body, params.updates);
    const result = await api.post<Record<string, unknown>>(`/groups/${params.group_id}`, body);
    return JSON.stringify({ action: "group_updated", group: result });
  }

  if (action === "delete_group") {
    if (!params.group_id) return JSON.stringify({ error: "Required: 'group_id'" });
    await api.delete(`/groups/${params.group_id}`);
    return JSON.stringify({ action: "group_deleted", group_id: params.group_id });
  }

  if (action === "add_to_group") {
    if (!params.group_id || !params.user_id) {
      return JSON.stringify({ error: "Required: 'group_id' and 'user_id'" });
    }
    const result = await api.put<Record<string, unknown>>(`/groups/${params.group_id}/memberships`, {
      userID: params.user_id,
    });
    return JSON.stringify({ action: "added_to_group", group_id: params.group_id, user_id: params.user_id, result });
  }

  if (action === "remove_from_group") {
    if (!params.group_id || !params.user_id) {
      return JSON.stringify({ error: "Required: 'group_id' and 'user_id'" });
    }
    await api.delete(`/groups/${params.group_id}/memberships/${params.user_id}`);
    return JSON.stringify({ action: "removed_from_group", group_id: params.group_id, user_id: params.user_id });
  }

  // ---- Channel actions ----

  if (action === "create_channel") {
    if (!params.name) return JSON.stringify({ error: "Required: 'name'" });
    const body: Record<string, unknown> = { name: params.name };
    if (params.updates) Object.assign(body, params.updates);
    const result = await api.put<Record<string, unknown>>("/channels", body);
    return JSON.stringify({ action: "channel_created", channel: result });
  }

  if (action === "update_channel") {
    if (!params.channel_id) return JSON.stringify({ error: "Required: 'channel_id'" });
    const body: Record<string, unknown> = {};
    if (params.name) body.name = params.name;
    if (params.updates) Object.assign(body, params.updates);
    const result = await api.post<Record<string, unknown>>(`/channels/${params.channel_id}`, body);
    return JSON.stringify({ action: "channel_updated", channel: result });
  }

  if (action === "delete_channel") {
    if (!params.channel_id) return JSON.stringify({ error: "Required: 'channel_id'" });
    await api.delete(`/channels/${params.channel_id}`);
    return JSON.stringify({ action: "channel_deleted", channel_id: params.channel_id });
  }

  // ---- Channel category actions ----

  if (action === "create_channel_category") {
    if (!params.name) return JSON.stringify({ error: "Required: 'name'" });
    const body: Record<string, unknown> = { name: params.name };
    if (params.updates) Object.assign(body, params.updates);
    const result = await api.put<Record<string, unknown>>("/channelCategories", body);
    return JSON.stringify({ action: "channel_category_created", category: result });
  }

  if (action === "update_channel_category") {
    const categoryId = params.updates?.categoryID ?? params.channel_id;
    if (!categoryId) return JSON.stringify({ error: "Required: 'channel_id' (used as category ID) or updates.categoryID" });
    const body: Record<string, unknown> = {};
    if (params.name) body.name = params.name;
    if (params.updates) Object.assign(body, params.updates);
    const result = await api.post<Record<string, unknown>>(`/channelCategories/${categoryId}`, body);
    return JSON.stringify({ action: "channel_category_updated", category: result });
  }

  if (action === "delete_channel_category") {
    const categoryId = params.updates?.categoryID ?? params.channel_id;
    if (!categoryId) return JSON.stringify({ error: "Required: 'channel_id' (used as category ID) or updates.categoryID" });
    await api.delete(`/channelCategories/${categoryId}`);
    return JSON.stringify({ action: "channel_category_deleted", category_id: categoryId });
  }

  // ---- Invitation actions ----

  if (action === "list_invitations") {
    const invitations = await api.get<unknown[]>("/invitations");
    return JSON.stringify({ count: invitations.length, invitations });
  }

  if (action === "create_invitation") {
    const body: Record<string, unknown> = {};
    if (params.updates) Object.assign(body, params.updates);
    const result = await api.put<Record<string, unknown>>("/invitations", body);
    return JSON.stringify({ action: "invitation_created", invitation: result });
  }

  if (action === "update_invitation") {
    if (!params.invitation_id) return JSON.stringify({ error: "Required: 'invitation_id'" });
    const body: Record<string, unknown> = {};
    if (params.updates) Object.assign(body, params.updates);
    const result = await api.post<Record<string, unknown>>(`/invitations/${params.invitation_id}`, body);
    return JSON.stringify({ action: "invitation_updated", invitation: result });
  }

  // ---- Webhook actions ----

  if (action === "list_webhooks") {
    const webhooks = await api.get<unknown[]>("/webhooks");
    return JSON.stringify({ count: webhooks.length, webhooks });
  }

  if (action === "create_webhook") {
    if (!params.webhook_url || !params.webhook_action) {
      return JSON.stringify({ error: "Required: 'webhook_url' and 'webhook_action'" });
    }
    const body: Record<string, unknown> = {
      url: params.webhook_url,
      action: params.webhook_action,
    };
    if (params.updates) Object.assign(body, params.updates);
    const result = await api.put<Record<string, unknown>>("/webhooks", body);
    return JSON.stringify({ action: "webhook_created", webhook: result });
  }

  if (action === "delete_webhook") {
    const webhookId = params.updates?.webhookID ?? params.channel_id;
    if (!webhookId) return JSON.stringify({ error: "Required: webhook ID via updates.webhookID or channel_id param" });
    await api.delete(`/webhooks/${webhookId}`);
    return JSON.stringify({ action: "webhook_deleted", webhook_id: webhookId });
  }

  // ---- Voice channel actions ----

  if (action === "create_voice_channel") {
    if (!params.name) return JSON.stringify({ error: "Required: 'name'" });
    const body: Record<string, unknown> = { name: params.name };
    if (params.updates) Object.assign(body, params.updates);
    const result = await api.put<Record<string, unknown>>("/voiceChannels", body);
    return JSON.stringify({ action: "voice_channel_created", voiceChannel: result });
  }

  if (action === "update_voice_channel") {
    const vcId = params.updates?.voiceChannelID ?? params.channel_id;
    if (!vcId) return JSON.stringify({ error: "Required: voice channel ID via updates.voiceChannelID or channel_id param" });
    const body: Record<string, unknown> = {};
    if (params.name) body.name = params.name;
    if (params.updates) Object.assign(body, params.updates);
    const result = await api.post<Record<string, unknown>>(`/voiceChannels/${vcId}`, body);
    return JSON.stringify({ action: "voice_channel_updated", voiceChannel: result });
  }

  // ---- Read-only list actions ----

  if (action === "list_roles") {
    const roles = await api.get<unknown[]>("/roles");
    return JSON.stringify({ count: roles.length, roles });
  }

  if (action === "list_offers") {
    const offers = await api.get<unknown[]>("/offers");
    return JSON.stringify({ count: offers.length, offers });
  }

  if (action === "list_signup_pages") {
    const pages = await api.get<unknown[]>("/signup_pages");
    return JSON.stringify({ count: pages.length, signup_pages: pages });
  }

  return JSON.stringify({
    error: `Unknown manage action: '${action}'. Valid actions: create_user, update_user, delete_user, reactivate_user, create_pending_user, create_group, update_group, delete_group, add_to_group, remove_from_group, create_channel, update_channel, delete_channel, create_channel_category, update_channel_category, delete_channel_category, list_invitations, create_invitation, update_invitation, list_webhooks, create_webhook, delete_webhook, create_voice_channel, update_voice_channel, list_roles, list_offers, list_signup_pages`,
  });
}
