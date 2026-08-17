import { UserButton } from "@clerk/react";
import * as RadixPopover from "@radix-ui/react-popover";
import {
	ArrowLeft,
	Bug,
	ChevronDown,
	CircleArrowDown,
	Ellipsis,
	GitBranch,
	Play,
	Plus,
	Settings,
	Terminal,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
	getRuntimeShortcutIconComponent,
	getRuntimeShortcutPickerOption,
	RUNTIME_SHORTCUT_ICON_OPTIONS,
	type RuntimeShortcutPickerIconId,
} from "@/components/shared/runtime-shortcut-icons";
import type { RuntimeGitSyncAction, RuntimeProjectShortcut, RuntimeProjectSummary } from "@/runtime/types";
import type { OpenTargetId, OpenTargetOption } from "@/utils/open-targets";

type SettingsSection = "shortcuts";
type CreateShortcutResult = { ok: boolean; message?: string };

function FirstShortcutIconPicker({
	value,
	onSelect,
}: {
	value: RuntimeShortcutPickerIconId;
	onSelect: (icon: RuntimeShortcutPickerIconId) => void;
}): React.ReactElement {
	const [open, setOpen] = useState(false);
	const selectedOption = getRuntimeShortcutPickerOption(value);
	const SelectedIconComponent = getRuntimeShortcutIconComponent(value);

	return (
		<RadixPopover.Root open={open} onOpenChange={setOpen}>
			<RadixPopover.Trigger asChild>
				<button
					type="button"
					aria-label={`Shortcut icon: ${selectedOption.label}`}
					className="inline-flex items-center gap-1 h-8 px-2 rounded-md border border-border bg-surface-2 text-text-primary hover:bg-surface-3"
				>
					<SelectedIconComponent size={14} />
					<ChevronDown size={12} />
				</button>
			</RadixPopover.Trigger>
			<RadixPopover.Portal>
				<RadixPopover.Content
					side="bottom"
					align="start"
					sideOffset={4}
					className="z-50 rounded-md border border-border bg-surface-2 p-1 shadow-lg"
					style={{ animation: "kb-tooltip-show 100ms ease" }}
				>
					<div className="flex gap-0.5">
						{RUNTIME_SHORTCUT_ICON_OPTIONS.map((option) => {
							const IconComponent = getRuntimeShortcutIconComponent(option.value);
							return (
								<button
									key={option.value}
									type="button"
									aria-label={option.label}
									className={cn(
										"p-1.5 rounded hover:bg-surface-3",
										selectedOption.value === option.value && "bg-surface-3",
									)}
									onClick={() => {
										onSelect(option.value);
										setOpen(false);
									}}
								>
									<IconComponent size={14} />
								</button>
							);
						})}
					</div>
				</RadixPopover.Content>
			</RadixPopover.Portal>
		</RadixPopover.Root>
	);
}

function projectTabLabel(project: RuntimeProjectSummary): string {
	if (project.name.trim()) {
		return project.name;
	}
	const segments = project.path.replaceAll("\\", "/").split("/").filter(Boolean);
	return segments[segments.length - 1] ?? project.id;
}

export function TopBar({
	onBack,
	workspacePath: _workspacePath,
	isWorkspacePathLoading: _isWorkspacePathLoading = false,
	workspaceHint: _workspaceHint,
	runtimeHint,
	selectedTaskId: _selectedTaskId,
	selectedTaskBaseRef: _selectedTaskBaseRef,
	showHomeGitSummary: _showHomeGitSummary,
	runningGitAction: _runningGitAction,
	onGitFetch,
	onGitPull: _onGitPull,
	onGitPush: _onGitPush,
	onToggleTerminal,
	isTerminalOpen,
	isTerminalLoading,
	onToggleGitHistory,
	isGitHistoryOpen,
	onOpenSettings,
	showDebugButton,
	onOpenDebugDialog,
	shortcuts,
	selectedShortcutLabel,
	onSelectShortcutLabel: _onSelectShortcutLabel,
	runningShortcutLabel,
	onRunShortcut,
	onCreateFirstShortcut,
	openTargetOptions: _openTargetOptions,
	selectedOpenTargetId: _selectedOpenTargetId,
	onSelectOpenTarget: _onSelectOpenTarget,
	onOpenWorkspace,
	canOpenWorkspace,
	isOpeningWorkspace: _isOpeningWorkspace,
	hideProjectDependentActions = false,
	isMobile: _isMobile = false,
	projects = [],
	currentProjectId = null,
	onSelectProject,
	onAddProject,
}: {
	onBack?: () => void;
	workspacePath?: string;
	isWorkspacePathLoading?: boolean;
	workspaceHint?: string;
	runtimeHint?: string;
	selectedTaskId?: string | null;
	selectedTaskBaseRef?: string | null;
	showHomeGitSummary?: boolean;
	runningGitAction?: RuntimeGitSyncAction | null;
	onGitFetch?: () => void;
	onGitPull?: () => void;
	onGitPush?: () => void;
	onToggleTerminal?: () => void;
	isTerminalOpen?: boolean;
	isTerminalLoading?: boolean;
	onToggleGitHistory?: () => void;
	isGitHistoryOpen?: boolean;
	onOpenSettings?: (section?: SettingsSection) => void;
	showDebugButton?: boolean;
	onOpenDebugDialog?: () => void;
	shortcuts?: RuntimeProjectShortcut[];
	selectedShortcutLabel?: string | null;
	onSelectShortcutLabel?: (shortcutLabel: string) => void;
	runningShortcutLabel?: string | null;
	onRunShortcut?: (shortcutLabel: string) => void;
	onCreateFirstShortcut?: (shortcut: RuntimeProjectShortcut) => Promise<CreateShortcutResult>;
	openTargetOptions: readonly OpenTargetOption[];
	selectedOpenTargetId: OpenTargetId;
	onSelectOpenTarget: (targetId: OpenTargetId) => void;
	onOpenWorkspace: () => void;
	canOpenWorkspace: boolean;
	isOpeningWorkspace: boolean;
	hideProjectDependentActions?: boolean;
	isMobile?: boolean;
	projects?: RuntimeProjectSummary[];
	currentProjectId?: string | null;
	onSelectProject?: (projectId: string) => void;
	onAddProject?: () => void;
}): React.ReactElement {
	const shortcutItems = shortcuts ?? [];
	const selectedShortcutIndex =
		selectedShortcutLabel === null || selectedShortcutLabel === undefined
			? 0
			: shortcutItems.findIndex((shortcut) => shortcut.label === selectedShortcutLabel);
	const selectedShortcut = shortcutItems[selectedShortcutIndex >= 0 ? selectedShortcutIndex : 0] ?? null;
	const SelectedShortcutIcon = selectedShortcut
		? getRuntimeShortcutIconComponent(selectedShortcut.icon)
		: Terminal;
	const [isCreateShortcutDialogOpen, setIsCreateShortcutDialogOpen] = useState(false);
	const [isCreateShortcutSaving, setIsCreateShortcutSaving] = useState(false);
	const [createShortcutError, setCreateShortcutError] = useState<string | null>(null);
	const [newShortcutIcon, setNewShortcutIcon] = useState<RuntimeShortcutPickerIconId>("play");
	const [newShortcutLabel, setNewShortcutLabel] = useState("Run");
	const [newShortcutCommand, setNewShortcutCommand] = useState("");
	const canSaveNewShortcut = newShortcutCommand.trim().length > 0;
	const handleOpenCreateShortcutDialog = () => {
		setCreateShortcutError(null);
		setNewShortcutIcon("play");
		setNewShortcutLabel("Run");
		setNewShortcutCommand("");
		setIsCreateShortcutDialogOpen(true);
	};
	const handleSaveFirstShortcut = async () => {
		if (!onCreateFirstShortcut || !canSaveNewShortcut || isCreateShortcutSaving) {
			return;
		}
		setCreateShortcutError(null);
		setIsCreateShortcutSaving(true);
		const result = await onCreateFirstShortcut({
			label: newShortcutLabel.trim(),
			command: newShortcutCommand.trim(),
			icon: newShortcutIcon,
		});
		setIsCreateShortcutSaving(false);
		if (!result.ok) {
			setCreateShortcutError(result.message ?? "Could not save shortcut.");
			return;
		}
		setIsCreateShortcutDialogOpen(false);
	};

	return (
		<>
			<nav
			className="flex flex-nowrap items-center h-10 min-h-[40px] min-w-0 bg-surface-1"
			style={{
				paddingLeft: onBack ? 6 : 12,
				paddingRight: 8,
				borderBottom: "1px solid var(--color-divider)",
			}}
		>
			<div
				className="flex flex-nowrap items-center h-10 flex-1 min-w-0 overflow-hidden gap-1.5"
			>
				{onBack ? (
					<Button
						variant="ghost"
						size="sm"
						icon={<ArrowLeft size={16} />}
						onClick={onBack}
						aria-label="Back to Phuong"
						className="mr-1 shrink-0"
					/>
				) : null}
				<div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
					{projects.map((project) => {
						const selected = project.id === currentProjectId;
						return (
							<button
								key={project.id}
								type="button"
								onClick={() => onSelectProject?.(project.id)}
								className={cn(
									"shrink-0 rounded-md px-2 py-1 text-[12px]",
									selected
										? "bg-surface-3 text-text-primary"
										: "text-text-secondary hover:bg-surface-2 hover:text-text-primary",
								)}
								title={project.path}
							>
								{projectTabLabel(project)}
							</button>
						);
					})}
					{onAddProject ? (
						<Button
							variant="ghost"
							size="sm"
							icon={<Plus size={14} />}
							onClick={onAddProject}
							aria-label="Add project"
							className="shrink-0"
						/>
					) : null}
				</div>
				{!hideProjectDependentActions && runtimeHint ? (
					onOpenSettings ? (
						<button
							type="button"
							onClick={() => onOpenSettings()}
							className="kb-navbar-tag inline-flex items-center rounded border border-status-orange/30 bg-status-orange/10 px-1.5 py-0.5 text-xs text-status-orange transition-colors hover:bg-status-orange/15 focus:outline-none focus:ring-2 focus:ring-border-focus focus:ring-offset-0"
						>
							{runtimeHint}
						</button>
					) : (
						<span className="kb-navbar-tag inline-flex items-center rounded border border-status-orange/30 bg-status-orange/10 px-1.5 py-0.5 text-xs text-status-orange">
							{runtimeHint}
						</span>
					)
				) : null}
			</div>
			<div className="flex flex-nowrap items-center h-10 pr-0.5 shrink-0">
				{!hideProjectDependentActions && !selectedShortcut && onCreateFirstShortcut ? (
					<Button
						variant="default"
						size="sm"
						icon={<Play size={14} />}
						onClick={handleOpenCreateShortcutDialog}
						className="text-xs kb-navbar-btn mr-1"
					>
						Run
					</Button>
				) : null}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger asChild>
						<Button
							variant="ghost"
							size="sm"
							icon={<Ellipsis size={16} />}
							aria-label="More"
							data-testid="top-bar-overflow"
						/>
					</DropdownMenu.Trigger>
					<DropdownMenu.Portal>
						<DropdownMenu.Content
							align="end"
							sideOffset={6}
							className="z-50 min-w-[200px] rounded-md border border-border bg-surface-2 p-1 shadow-xl"
						>
							<DropdownMenu.Item
								className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-text-primary outline-none hover:bg-surface-3"
								onSelect={() => onOpenSettings?.()}
							>
								<Settings size={14} />
								Settings
							</DropdownMenu.Item>
							{!hideProjectDependentActions && onToggleGitHistory ? (
								<DropdownMenu.Item
									className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-text-primary outline-none hover:bg-surface-3"
									onSelect={onToggleGitHistory}
								>
									<GitBranch size={14} />
									{isGitHistoryOpen ? "Hide git history" : "Git history"}
								</DropdownMenu.Item>
							) : null}
							{onToggleTerminal ? (
								<DropdownMenu.Item
									className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-text-primary outline-none hover:bg-surface-3"
									disabled={Boolean(isTerminalLoading)}
									onSelect={onToggleTerminal}
								>
									<Terminal size={14} />
									{isTerminalOpen ? "Hide terminal" : "Live terminal"}
								</DropdownMenu.Item>
							) : null}
							{!hideProjectDependentActions && onRunShortcut && selectedShortcut ? (
								<DropdownMenu.Item
									className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-text-primary outline-none hover:bg-surface-3"
									disabled={Boolean(runningShortcutLabel)}
									onSelect={() => onRunShortcut(selectedShortcut.label)}
								>
									<SelectedShortcutIcon size={14} />
									{selectedShortcut.label}
								</DropdownMenu.Item>
							) : null}
							{!hideProjectDependentActions && !selectedShortcut && onCreateFirstShortcut ? (
								<DropdownMenu.Item
									className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-text-primary outline-none hover:bg-surface-3"
									onSelect={handleOpenCreateShortcutDialog}
								>
									<Play size={14} />
									Run
								</DropdownMenu.Item>
							) : null}
							{!hideProjectDependentActions && onGitFetch ? (
								<DropdownMenu.Item
									className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-text-primary outline-none hover:bg-surface-3"
									onSelect={onGitFetch}
								>
									<CircleArrowDown size={14} />
									Fetch
								</DropdownMenu.Item>
							) : null}
							{canOpenWorkspace ? (
								<DropdownMenu.Item
									className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-text-primary outline-none hover:bg-surface-3"
									onSelect={onOpenWorkspace}
								>
									Open workspace
								</DropdownMenu.Item>
							) : null}
							{showDebugButton && onOpenDebugDialog ? (
								<DropdownMenu.Item
									className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-text-primary outline-none hover:bg-surface-3"
									onSelect={onOpenDebugDialog}
									data-testid="open-debug-dialog-button"
								>
									<Bug size={14} />
									Debug
								</DropdownMenu.Item>
							) : null}
						</DropdownMenu.Content>
					</DropdownMenu.Portal>
				</DropdownMenu.Root>
				{import.meta.env.VITE_CLERK_PUBLISHABLE_KEY && (
					<UserButton
						appearance={{
							elements: {
								avatarBox: "w-7 h-7",
							},
						}}
					/>
				)}
			</div>
			</nav>
			<Dialog
				open={isCreateShortcutDialogOpen}
				contentAriaDescribedBy={undefined}
				onOpenChange={(nextOpen) => {
					if (isCreateShortcutSaving) {
						return;
					}
					setIsCreateShortcutDialogOpen(nextOpen);
					if (!nextOpen) {
						setCreateShortcutError(null);
					}
				}}
			>
				<DialogHeader title="Set up your first script shortcut" icon={<Play size={16} />} />
				<DialogBody>
					<p className="text-text-secondary text-[13px] mt-0 mb-2">
						Script shortcuts run a command in the bottom terminal so you can quickly run and test your project.
					</p>
					<p className="text-text-secondary text-[13px] mt-0 mb-3">
						You can always open Settings to add and manage more shortcuts later.
					</p>
					<div className="grid gap-2" style={{ gridTemplateColumns: "max-content 1fr 2fr" }}>
						<FirstShortcutIconPicker value={newShortcutIcon} onSelect={setNewShortcutIcon} />
						<input
							value={newShortcutLabel}
							onChange={(event) => setNewShortcutLabel(event.target.value)}
							placeholder="Label"
							disabled={isCreateShortcutSaving}
							className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-60"
						/>
						<input
							value={newShortcutCommand}
							onChange={(event) => setNewShortcutCommand(event.target.value)}
							placeholder="npm run dev"
							disabled={isCreateShortcutSaving}
							className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-60"
						/>
					</div>
					{createShortcutError ? <p className="text-status-red text-[13px] mt-3 mb-0">{createShortcutError}</p> : null}
				</DialogBody>
				<DialogFooter>
					<Button
						onClick={() => {
							if (!isCreateShortcutSaving) {
								setIsCreateShortcutDialogOpen(false);
								setCreateShortcutError(null);
							}
						}}
						disabled={isCreateShortcutSaving}
					>
						Cancel
					</Button>
					<Button
						variant="primary"
						onClick={() => {
							void handleSaveFirstShortcut();
						}}
						disabled={!canSaveNewShortcut || isCreateShortcutSaving}
					>
						{isCreateShortcutSaving ? (
							<>
								<Spinner size={12} />
								Saving...
							</>
						) : (
							"Save"
						)}
					</Button>
				</DialogFooter>
			</Dialog>
		</>
	);
}
