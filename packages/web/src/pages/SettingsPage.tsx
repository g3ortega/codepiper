import { FolderOpen, KeyRound, RotateCcw, Settings, Shield } from "lucide-react";
import { DaemonSettings } from "@/components/settings/DaemonSettings";
import { EnvSetList } from "@/components/settings/EnvSetList";
import { SecuritySettings } from "@/components/settings/SecuritySettings";
import { WorkspaceList } from "@/components/settings/WorkspaceList";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function SettingsPage() {
  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="mb-4 md:mb-6">
        <div className="flex items-center gap-2 md:gap-3 mb-1">
          <Settings className="h-5 w-5 md:h-6 md:w-6 text-cyan-400" />
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Settings</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1 ml-7 md:ml-9">
          Manage workspaces, environment variables, and security
        </p>
      </div>

      <Tabs defaultValue="workspaces">
        <TabsList className="bg-muted/50 border border-border mb-4 md:mb-6">
          <TabsTrigger
            value="workspaces"
            className="data-[state=active]:bg-background data-[state=active]:text-foreground text-xs md:text-sm gap-1.5"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Workspaces
          </TabsTrigger>
          <TabsTrigger
            value="env-sets"
            className="data-[state=active]:bg-background data-[state=active]:text-foreground text-xs md:text-sm gap-1.5"
          >
            <KeyRound className="h-3.5 w-3.5" />
            Env Sets
          </TabsTrigger>
          <TabsTrigger
            value="security"
            className="data-[state=active]:bg-background data-[state=active]:text-foreground text-xs md:text-sm gap-1.5"
          >
            <Shield className="h-3.5 w-3.5" />
            Security
          </TabsTrigger>
          <TabsTrigger
            value="daemon"
            className="data-[state=active]:bg-background data-[state=active]:text-foreground text-xs md:text-sm gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Daemon
          </TabsTrigger>
        </TabsList>

        <TabsContent value="workspaces">
          <WorkspaceList />
        </TabsContent>

        <TabsContent value="env-sets">
          <EnvSetList />
        </TabsContent>

        <TabsContent value="security">
          <SecuritySettings />
        </TabsContent>

        <TabsContent value="daemon">
          <DaemonSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
