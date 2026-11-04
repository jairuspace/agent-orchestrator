import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AllProjectsBoard } from "./SessionsBoard";
import { TooltipProvider } from "./ui/tooltip";

const mocks = vi.hoisted(() => ({
	navigate: vi.fn(),
	connected: [] as string[],
	localWorkspaces: [] as Array<Record<string, unknown>>,
	remoteWorkspaces: [] as Array<Record<string, unknown>>,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...await importOriginal<typeof import("@tanstack/react-router")>(),
	useNavigate: () => mocks.navigate,
}));
vi.mock("../hooks/useWorkspaceQuery", () => ({
	workspaceQueryKey: ["workspaces"],
	cloudSessionsQueryKey: ["cloud-sessions"],
	remoteWorkspaceQueryKey: (hostId: string) => ["remote-workspaces", hostId],
	workspaceQueryKeyForHost: (hostId?: string) => hostId ? ["remote-workspaces", hostId] : ["workspaces"],
	useWorkspaceQuery: () => ({ data: mocks.localWorkspaces, isError: false, isSuccess: true }),
	useRemoteWorkspaces: () => ({ data: mocks.remoteWorkspaces, failedHostIds: [], loadedProjectHostIds: mocks.connected }),
	useRemoteProjectQuery: () => ({ data: undefined, isError: false, isSuccess: false }),
	useCloudProjectsQuery: () => ({ data: undefined }),
}));
vi.mock("../hooks/useBoardPresentation", () => ({
	useBoardPresentation: () => ({ showStartup: false, showWelcome: false, showProjectEmpty: false, workspaceStartupState: "ready" }),
}));
vi.mock("../lib/api-client", () => ({
	apiClient: { GET: vi.fn(), POST: vi.fn() },
	apiErrorCode: (error: { code?: string }) => error?.code,
	apiErrorMessage: (error: { message?: string }, fallback: string) => error?.message ?? fallback,
}));
vi.mock("../lib/host-clients", () => ({
	clientForHost: () => ({ GET: vi.fn().mockResolvedValue({ data: { prs: [] } }), POST: vi.fn() }),
	connectedHosts: () => mocks.connected,
	labelForHost: (hostId: string) => `Host ${hostId}`,
	subscribeConnectedHosts: () => () => undefined,
}));
vi.mock("../lib/shell-context", () => ({
	useShellMaybe: () => ({ openRemoteProjectSettings: vi.fn() }),
}));
vi.mock("../stores/ui-store", () => {
	const state = {
		developerMode: false,
		diagnostics: false,
		remoteHosts: true,
		requestNewTask: vi.fn(),
		showGlobalToast: vi.fn(),
		restartingProjectIds: new Set<string>(),
		provisioningProjectIds: new Set<string>(),
		orchestratorStartupErrors: {} as Record<string, string>,
		setProjectRestarting: vi.fn(),
		setOrchestratorStartupError: vi.fn(),
	};
	return {
		sidebarOccupiesLayout: () => true,
		useUiStore: Object.assign((selector: (value: typeof state) => unknown) => selector(state), { getState: () => state }),
	};
});
vi.mock("./NotificationCenter", () => ({ NotificationCenter: () => null }));
vi.mock("../lib/telemetry", () => ({ captureRendererEvent: vi.fn() }));

/** A worker session as the board receives it; `hostId` set only for remote sessions. */
function session(id: string, title: string, workspaceName: string, hostId?: string) {
	return {
		...(hostId ? { hostId } : {}), id, workspaceId: `ws-${workspaceName}`, workspaceName, title,
		provider: "opencode", kind: "worker", status: "working",
		updatedAt: "2026-09-28T00:00:00Z", prs: [],
	};
}

const clients: QueryClient[] = [];

function renderAllProjects() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	clients.push(client);
	return render(
		<QueryClientProvider client={client}>
			<TooltipProvider><AllProjectsBoard /></TooltipProvider>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	mocks.navigate.mockReset();
	mocks.connected = [];
	mocks.localWorkspaces = [{ id: "ws-Alpha", name: "Alpha", sessions: [session("a1", "Local alpha task", "Alpha")] }];
	mocks.remoteWorkspaces = [];
});

afterEach(async () => {
	cleanup();
	for (const client of clients.splice(0)) client.clear();
	await new Promise((resolve) => setTimeout(resolve, 0));
});

function cardFor(title: string): HTMLElement {
	return screen.getByText(title).closest('[data-testid="board-session-card"]') as HTMLElement;
}

it("aggregates sessions from several projects on this machine and from every connected host", () => {
	mocks.connected = ["box-a"];
	mocks.localWorkspaces = [
		{ id: "ws-Alpha", name: "Alpha", sessions: [session("a1", "Local alpha task", "Alpha")] },
		{ id: "ws-Beta", name: "Beta", sessions: [session("b1", "Local beta task", "Beta")] },
	];
	mocks.remoteWorkspaces = [
		{ hostId: "box-a", id: "ws-Gamma", name: "Gamma", sessions: [session("g1", "Remote gamma task", "Gamma", "box-a")] },
	];
	renderAllProjects();
	expect(screen.getByTestId("board")).toHaveAttribute("data-scope", "all-projects");
	expect(screen.getByText("Local alpha task")).toBeVisible();
	expect(screen.getByText("Local beta task")).toBeVisible();
	expect(screen.getByText("Remote gamma task")).toBeVisible();
});

it("labels each card with its project, and the host only when more than one machine is connected", () => {
	mocks.connected = ["box-a"];
	mocks.remoteWorkspaces = [
		{ hostId: "box-a", id: "ws-Gamma", name: "Gamma", sessions: [session("g1", "Remote gamma task", "Gamma", "box-a")] },
	];
	renderAllProjects();
	expect(within(cardFor("Local alpha task")).getByText("Alpha · This computer")).toBeVisible();
	expect(within(cardFor("Remote gamma task")).getByText("Gamma · Host box-a")).toBeVisible();
});

it("shows only the project on each card while this is the only machine", () => {
	renderAllProjects();
	const context = within(cardFor("Local alpha task")).getByText("Alpha");
	expect(context).toHaveAttribute("data-board-context");
	expect(context.textContent).toBe("Alpha");
	expect(screen.queryByText(/This computer/)).toBeNull();
});

it("offers no project-only controls", () => {
	mocks.connected = ["box-a"];
	renderAllProjects();
	expect(screen.queryByRole("button", { name: "New task" })).toBeNull();
	expect(screen.queryByRole("button", { name: /orchestrator/i })).toBeNull();
	expect(screen.queryByRole("button", { name: /project settings/i })).toBeNull();
});
