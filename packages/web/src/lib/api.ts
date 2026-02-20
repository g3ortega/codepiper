/**
 * API client for communicating with the daemon
 */

import type {
  CreateSessionRequest,
  DaemonSettings,
  DaemonTerminalFeaturesSettings,
  EnvSet,
  Event,
  EventsQuery,
  GitDiffStatEntry,
  GitLogEntry,
  GitStatusEntry,
  HealthStatus,
  NotificationListQuery,
  Policy,
  PolicyDecision,
  PolicySet,
  PolicySetSummary,
  ProviderInfo,
  PushDeliveryStatus,
  PushSubscriptionPayload,
  PushSubscriptionRecord,
  PushTestResult,
  SendKeysRequest,
  SendTextRequest,
  Session,
  SessionNotificationCounts,
  SessionNotificationPrefsRecord,
  SessionNotificationRecord,
  TerminalInfo,
  UpdateSessionNameRequest,
  ValidateGitRequest,
  ValidateGitResult,
  ValidateSessionRequest,
  ValidateSessionResult,
  Workflow,
  WorkflowExecution,
  Workspace,
} from "@/types/api";

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl = "/api") {
    this.baseUrl = baseUrl;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    try {
      const response = await fetch(url, {
        ...init,
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          ...init?.headers,
        },
      });

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        let errorData: unknown;

        try {
          errorData = await response.json();
          if (errorData && typeof errorData === "object" && "error" in errorData) {
            errorMessage = String(errorData.error);
          }
        } catch {
          // Ignore JSON parse errors
        }

        throw new ApiError(errorMessage, response.status, errorData);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(error instanceof Error ? error.message : "Network error", 0);
    }
  }

  // Health
  async getHealth(): Promise<HealthStatus> {
    return this.request("/health");
  }

  async getVersion(): Promise<{ version: string }> {
    return this.request("/version");
  }

  async getProviders(): Promise<{ providers: ProviderInfo[] }> {
    return this.request("/providers");
  }

  // Sessions
  async getSessions(): Promise<{ sessions: Session[] }> {
    return this.request("/sessions");
  }

  async getSession(id: string): Promise<{ session: Session }> {
    return this.request(`/sessions/${id}`);
  }

  async updateSessionName(
    id: string,
    req: UpdateSessionNameRequest
  ): Promise<{ session: Session }> {
    return this.request(`/sessions/${id}/name`, {
      method: "PUT",
      body: JSON.stringify(req),
    });
  }

  async createSession(req: CreateSessionRequest): Promise<{ session: Session }> {
    return this.request("/sessions", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  async stopSession(id: string): Promise<{ success: boolean }> {
    return this.request(`/sessions/${id}/stop`, { method: "POST" });
  }

  async killSession(id: string): Promise<{ success: boolean }> {
    return this.request(`/sessions/${id}/kill`, { method: "POST" });
  }

  async resumeSession(id: string): Promise<{ session: Session }> {
    return this.request(`/sessions/${id}/resume`, { method: "POST" });
  }

  async recoverSession(id: string): Promise<{ session: Session }> {
    return this.request(`/sessions/${id}/recover`, { method: "POST" });
  }

  async sendText(id: string, req: SendTextRequest): Promise<void> {
    await this.request(`/sessions/${id}/send`, {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  async uploadImage(
    sessionId: string,
    file: File,
    opts?: { onProgress?: (progressPercent: number) => void }
  ): Promise<{ path: string; filename: string }> {
    const url = `${this.baseUrl}/sessions/${sessionId}/upload-image`;
    const formData = new FormData();
    formData.append("image", file);

    if (opts?.onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url, true);
        xhr.responseType = "json";

        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          const progressPercent = Math.max(
            0,
            Math.min(100, Math.round((event.loaded / event.total) * 100))
          );
          opts.onProgress?.(progressPercent);
        };

        xhr.onload = () => {
          if (xhr.status < 200 || xhr.status >= 300) {
            const responseError =
              xhr.response && typeof xhr.response === "object" && "error" in xhr.response
                ? String((xhr.response as Record<string, unknown>).error)
                : `HTTP ${xhr.status}: ${xhr.statusText}`;
            reject(new ApiError(responseError, xhr.status));
            return;
          }
          const payload =
            xhr.response && typeof xhr.response === "object"
              ? (xhr.response as { path: string; filename: string })
              : null;
          if (!payload?.path) {
            reject(new ApiError("Invalid upload response payload", xhr.status || 500));
            return;
          }
          opts.onProgress?.(100);
          resolve(payload);
        };

        xhr.onerror = () => {
          reject(new ApiError("Network error during upload", xhr.status || 0));
        };

        xhr.send(formData);
      });
    }

    const response = await fetch(url, {
      method: "POST",
      body: formData,
      // Do NOT set Content-Type — browser sets it with multipart boundary
    });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData?.error) {
          errorMessage = String(errorData.error);
        }
      } catch {
        // Ignore JSON parse errors
      }
      throw new ApiError(errorMessage, response.status);
    }

    return await response.json();
  }

  async transcribeAudio(
    sessionId: string,
    audioBlob: Blob,
    filename = "voice.webm"
  ): Promise<{ transcript: string; backend: string; durationMs: number }> {
    const url = `${this.baseUrl}/sessions/${sessionId}/terminal/transcribe`;
    const formData = new FormData();
    formData.append("audio", new File([audioBlob], filename, { type: audioBlob.type }));

    const response = await fetch(url, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData?.error) {
          errorMessage = String(errorData.error);
        }
      } catch {
        // Ignore JSON parse errors
      }
      throw new ApiError(errorMessage, response.status);
    }

    return await response.json();
  }

  async sendKeys(id: string, req: SendKeysRequest): Promise<void> {
    await this.request(`/sessions/${id}/keys`, {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  async resizeSession(id: string, cols: number, rows: number): Promise<{ success: boolean }> {
    return this.request(`/sessions/${id}/resize`, {
      method: "POST",
      body: JSON.stringify({ cols, rows }),
    });
  }

  async getSessionOutput(id: string): Promise<{ output: string }> {
    return this.request(`/sessions/${id}/output`);
  }

  async getEvents(id: string, query?: EventsQuery): Promise<{ events: Event[]; hasMore: boolean }> {
    const params = new URLSearchParams();
    if (query?.since) params.append("since", String(query.since));
    if (query?.before) params.append("before", String(query.before));
    if (query?.limit) params.append("limit", String(query.limit));
    if (query?.source) params.append("source", query.source);
    if (query?.type) params.append("type", query.type);
    if (query?.order) params.append("order", query.order);

    const queryString = params.toString();
    const url = `/sessions/${id}/events${queryString ? `?${queryString}` : ""}`;

    return this.request(url);
  }

  // Policies
  async getPolicies(): Promise<{ policies: Policy[] }> {
    return this.request("/policies");
  }

  async getPolicy(id: string): Promise<{ policy: Policy }> {
    return this.request(`/policies/${id}`);
  }

  async createPolicy(policy: Partial<Policy>): Promise<{ policy: Policy }> {
    return this.request("/policies", {
      method: "POST",
      body: JSON.stringify(policy),
    });
  }

  async updatePolicy(id: string, policy: Partial<Policy>): Promise<{ policy: Policy }> {
    return this.request(`/policies/${id}`, {
      method: "PUT",
      body: JSON.stringify(policy),
    });
  }

  async deletePolicy(id: string): Promise<{ success: boolean }> {
    return this.request(`/policies/${id}`, { method: "DELETE" });
  }

  // Policy Sets
  async getPolicySets(): Promise<{ policySets: PolicySetSummary[] }> {
    return this.request("/policy-sets");
  }

  async getPolicySet(id: string): Promise<{ policySet: PolicySet }> {
    return this.request(`/policy-sets/${id}`);
  }

  async createPolicySet(set: {
    id: string;
    name: string;
    description?: string;
    isDefault?: boolean;
    policyIds?: string[];
  }): Promise<{ policySet: PolicySet }> {
    return this.request("/policy-sets", {
      method: "POST",
      body: JSON.stringify(set),
    });
  }

  async updatePolicySet(
    id: string,
    updates: { name?: string; description?: string; isDefault?: boolean }
  ): Promise<{ policySet: PolicySet }> {
    return this.request(`/policy-sets/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });
  }

  async deletePolicySet(id: string): Promise<{ success: boolean }> {
    return this.request(`/policy-sets/${id}`, { method: "DELETE" });
  }

  async addPolicyToSet(setId: string, policyId: string): Promise<{ success: boolean }> {
    return this.request(`/policy-sets/${setId}/policies`, {
      method: "POST",
      body: JSON.stringify({ policyId }),
    });
  }

  async removePolicyFromSet(setId: string, policyId: string): Promise<{ success: boolean }> {
    return this.request(`/policy-sets/${setId}/policies/${policyId}`, { method: "DELETE" });
  }

  // Session Policy Sets
  async getSessionPolicySets(sessionId: string): Promise<{ policySets: PolicySetSummary[] }> {
    return this.request(`/sessions/${sessionId}/policy-sets`);
  }

  async applyPolicySetToSession(
    sessionId: string,
    policySetId: string
  ): Promise<{ success: boolean }> {
    return this.request(`/sessions/${sessionId}/policy-sets`, {
      method: "POST",
      body: JSON.stringify({ policySetId }),
    });
  }

  async removePolicySetFromSession(
    sessionId: string,
    setId: string
  ): Promise<{ success: boolean }> {
    return this.request(`/sessions/${sessionId}/policy-sets/${setId}`, { method: "DELETE" });
  }

  async getEffectivePolicies(sessionId: string): Promise<{ policies: Policy[] }> {
    return this.request(`/sessions/${sessionId}/effective-policies`);
  }

  // Policy Decisions (Audit Log)
  async getPolicyDecisions(params?: {
    sessionId?: string;
    decision?: "allow" | "deny" | "ask";
    limit?: number;
  }): Promise<{ decisions: PolicyDecision[] }> {
    const searchParams = new URLSearchParams();
    if (params?.sessionId) searchParams.append("sessionId", params.sessionId);
    if (params?.decision) searchParams.append("decision", params.decision);
    if (params?.limit) searchParams.append("limit", String(params.limit));
    const qs = searchParams.toString();
    return this.request(`/policy-decisions${qs ? `?${qs}` : ""}`);
  }

  // Workflows
  async getWorkflows(): Promise<{ workflows: Workflow[] }> {
    return this.request("/workflows");
  }

  async getWorkflow(id: string): Promise<{ workflow: Workflow }> {
    return this.request(`/workflows/${id}`);
  }

  async createWorkflow(workflow: Partial<Workflow>): Promise<{ workflow: Workflow }> {
    return this.request("/workflows", {
      method: "POST",
      body: JSON.stringify(workflow),
    });
  }

  async executeWorkflow(
    id: string,
    variables?: Record<string, unknown>
  ): Promise<{ executionId: string; status: string }> {
    return this.request(`/workflows/${id}/execute`, {
      method: "POST",
      body: JSON.stringify({ variables }),
    });
  }

  async getWorkflowExecutions(id: string): Promise<{ executions: WorkflowExecution[] }> {
    return this.request(`/workflows/${id}/executions`);
  }

  async getWorkflowExecution(
    workflowId: string,
    execId: string
  ): Promise<{ execution: WorkflowExecution }> {
    return this.request(`/workflows/${workflowId}/executions/${execId}`);
  }

  async cancelExecution(workflowId: string, execId: string): Promise<{ success: boolean }> {
    return this.request(`/workflows/${workflowId}/executions/${execId}/cancel`, {
      method: "POST",
    });
  }

  // Workspaces
  async getWorkspaces(): Promise<{ workspaces: Workspace[] }> {
    return this.request("/workspaces");
  }

  async createWorkspace(params: { name: string; path: string }): Promise<{ workspace: Workspace }> {
    return this.request("/workspaces", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async updateWorkspace(
    id: string,
    params: { name?: string; path?: string }
  ): Promise<{ workspace: Workspace }> {
    return this.request(`/workspaces/${id}`, {
      method: "PUT",
      body: JSON.stringify(params),
    });
  }

  async deleteWorkspace(id: string): Promise<{ success: boolean }> {
    return this.request(`/workspaces/${id}`, { method: "DELETE" });
  }

  // Env Sets
  async getEnvSets(): Promise<{ envSets: EnvSet[] }> {
    return this.request("/env-sets");
  }

  async createEnvSet(params: {
    name: string;
    description?: string;
    vars: Record<string, string>;
  }): Promise<{ envSet: EnvSet }> {
    return this.request("/env-sets", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async updateEnvSet(
    id: string,
    params: { name?: string; description?: string; vars?: Record<string, string> }
  ): Promise<{ envSet: EnvSet }> {
    return this.request(`/env-sets/${id}`, {
      method: "PUT",
      body: JSON.stringify(params),
    });
  }

  async deleteEnvSet(id: string): Promise<{ success: boolean }> {
    return this.request(`/env-sets/${id}`, { method: "DELETE" });
  }

  // Daemon Settings
  async getDaemonSettings(): Promise<{ settings: DaemonSettings }> {
    return this.request("/settings/daemon");
  }

  async updateDaemonSettings(params: {
    preserveSessions?: boolean;
    defaultPolicyAction?: "ask" | "deny";
    forwardSshAuthSock?: boolean;
    codexHostAccessProfileEnabled?: boolean;
    terminalFeatures?: Partial<DaemonTerminalFeaturesSettings>;
    notificationsEnabled?: boolean;
    systemNotificationsEnabled?: boolean;
    notificationSoundsEnabled?: boolean;
    notificationEventDefaults?: Record<string, boolean>;
    notificationSoundMap?: Record<string, string>;
  }): Promise<{ settings: DaemonSettings }> {
    return this.request("/settings/daemon", {
      method: "PUT",
      body: JSON.stringify(params),
    });
  }

  async restartDaemon(): Promise<{
    restarting: boolean;
    preserveSessions: boolean;
    message: string;
  }> {
    return this.request("/settings/daemon/restart", {
      method: "POST",
    });
  }

  // Notifications
  async getNotifications(
    query?: NotificationListQuery
  ): Promise<{ notifications: SessionNotificationRecord[] }> {
    const params = new URLSearchParams();
    if (query?.sessionId) params.append("sessionId", query.sessionId);
    if (query?.eventType) params.append("eventType", query.eventType);
    if (typeof query?.unreadOnly === "boolean") {
      params.append("unreadOnly", query.unreadOnly ? "true" : "false");
    }
    if (typeof query?.before === "number") params.append("before", String(query.before));
    if (typeof query?.limit === "number") params.append("limit", String(query.limit));
    const qs = params.toString();
    return this.request(`/notifications${qs ? `?${qs}` : ""}`);
  }

  async getNotificationCounts(): Promise<{ counts: SessionNotificationCounts }> {
    return this.request("/notifications/counts");
  }

  async markNotificationRead(
    notificationId: number,
    readSource?: string
  ): Promise<{ success: true; changed: boolean }> {
    return this.request(`/notifications/${notificationId}/read`, {
      method: "POST",
      body: JSON.stringify(readSource ? { readSource } : {}),
    });
  }

  async markNotificationsRead(params?: {
    sessionId?: string;
    readSource?: string;
  }): Promise<{ success: true; updated: number }> {
    return this.request("/notifications/read", {
      method: "POST",
      body: JSON.stringify(params ?? {}),
    });
  }

  async getSessionNotificationPrefs(
    sessionId: string
  ): Promise<{ prefs: SessionNotificationPrefsRecord }> {
    return this.request(`/sessions/${sessionId}/notifications/prefs`);
  }

  async updateSessionNotificationPrefs(
    sessionId: string,
    enabled: boolean | null
  ): Promise<{ prefs: SessionNotificationPrefsRecord }> {
    return this.request(`/sessions/${sessionId}/notifications/prefs`, {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    });
  }

  async listPushSubscriptions(): Promise<{ subscriptions: PushSubscriptionRecord[] }> {
    return this.request("/notifications/push/subscriptions");
  }

  async getPushDeliveryStatus(): Promise<{ status: PushDeliveryStatus }> {
    return this.request("/notifications/push/status");
  }

  async sendTestPushNotification(params?: {
    title?: string;
    body?: string;
    sessionId?: string;
  }): Promise<{ result: PushTestResult }> {
    return this.request("/notifications/push/test", {
      method: "POST",
      body: JSON.stringify(params ?? {}),
    });
  }

  async upsertPushSubscription(
    subscription: PushSubscriptionPayload
  ): Promise<{ subscription: PushSubscriptionRecord }> {
    return this.request("/notifications/push/subscriptions", {
      method: "PUT",
      body: JSON.stringify(subscription),
    });
  }

  async deletePushSubscription(endpoint: string): Promise<{ success: true; deleted: boolean }> {
    return this.request("/notifications/push/subscriptions", {
      method: "DELETE",
      body: JSON.stringify({ endpoint }),
    });
  }

  // Validation
  async validateSession(req: ValidateSessionRequest): Promise<ValidateSessionResult> {
    return this.request("/sessions/validate", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  async validateGit(req: ValidateGitRequest): Promise<ValidateGitResult> {
    return this.request("/sessions/validate-git", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  // Git
  async getGitStatus(sessionId: string): Promise<{ status: GitStatusEntry[]; branch: string }> {
    return this.request(`/sessions/${sessionId}/git/status`);
  }

  async getGitLog(sessionId: string, limit = 50): Promise<{ log: GitLogEntry[] }> {
    return this.request(`/sessions/${sessionId}/git/log?limit=${limit}`);
  }

  async getGitDiff(
    sessionId: string,
    params?: {
      staged?: boolean;
      commit?: string;
      commitA?: string;
      commitB?: string;
      path?: string;
    }
  ): Promise<{ diff: string }> {
    const searchParams = new URLSearchParams();
    if (params?.staged) searchParams.append("staged", "true");
    if (params?.commit) searchParams.append("commit", params.commit);
    if (params?.commitA) searchParams.append("commitA", params.commitA);
    if (params?.commitB) searchParams.append("commitB", params.commitB);
    if (params?.path) searchParams.append("path", params.path);
    const qs = searchParams.toString();
    return this.request(`/sessions/${sessionId}/git/diff${qs ? `?${qs}` : ""}`);
  }

  async getGitFile(sessionId: string, ref: string, filePath: string): Promise<{ content: string }> {
    const params = new URLSearchParams({ ref, path: filePath });
    return this.request(`/sessions/${sessionId}/git/file?${params}`);
  }

  async getGitFileRawBlob(sessionId: string, ref: string, filePath: string): Promise<Blob | null> {
    const params = new URLSearchParams({ ref, path: filePath });
    try {
      const response = await fetch(`${this.baseUrl}/sessions/${sessionId}/git/file-raw?${params}`);
      if (!response.ok) return null;
      return await response.blob();
    } catch {
      return null;
    }
  }

  async getGitBranches(sessionId: string): Promise<{ branches: string[]; currentBranch: string }> {
    return this.request(`/sessions/${sessionId}/git/branches`);
  }

  async getGitDiffStat(
    sessionId: string,
    ref: string,
    base?: string
  ): Promise<{ files: GitDiffStatEntry[] }> {
    const params = new URLSearchParams({ ref });
    if (base) params.append("base", base);
    return this.request(`/sessions/${sessionId}/git/diff-stat?${params}`);
  }

  async stageFiles(sessionId: string, paths: string[]): Promise<{ success: boolean }> {
    return this.request(`/sessions/${sessionId}/git/stage`, {
      method: "POST",
      body: JSON.stringify({ paths }),
    });
  }

  async unstageFiles(sessionId: string, paths: string[]): Promise<{ success: boolean }> {
    return this.request(`/sessions/${sessionId}/git/unstage`, {
      method: "POST",
      body: JSON.stringify({ paths }),
    });
  }

  // Terminal modes (scroll, search)
  async getTerminalInfo(sessionId: string): Promise<TerminalInfo> {
    return this.request(`/sessions/${sessionId}/terminal/info`);
  }

  async setTerminalMode(
    sessionId: string,
    mode: "interactive" | "scroll"
  ): Promise<{ success: boolean }> {
    return this.request(`/sessions/${sessionId}/terminal/mode`, {
      method: "POST",
      body: JSON.stringify({ mode }),
    });
  }

  async scrollTerminal(
    sessionId: string,
    params: {
      direction?: "up" | "down";
      lines?: number;
      page?: boolean;
      edge?: "top" | "bottom";
    }
  ): Promise<{ success: boolean }> {
    return this.request(`/sessions/${sessionId}/terminal/scroll`, {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async searchTerminal(
    sessionId: string,
    params: { query?: string; action?: "next" | "previous" | "cancel" }
  ): Promise<{ success: boolean }> {
    return this.request(`/sessions/${sessionId}/terminal/search`, {
      method: "POST",
      body: JSON.stringify(params),
    });
  }
}

export const api = new ApiClient();
