import { Project } from "@/project/project"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ApiNotFoundError, ProjectNotFoundError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware, ProjectContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/project"
const UpdatePayload = Schema.Struct({
  name: Schema.optional(Schema.String),
  icon: Schema.optional(Project.Info.fields.icon),
  commands: Schema.optional(Project.Info.fields.commands),
})

export const ProjectApi = HttpApi.make("project")
  .add(
    HttpApiGroup.make("project")
      .add(
        HttpApiEndpoint.get("list", root, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(Project.Info), "List of projects"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "project.list",
            summary: "List all projects",
            description: "Get a list of projects that have been opened with OpenCode.",
          }),
        ),
        HttpApiEndpoint.post("create", root, {
          query: WorkspaceRoutingQuery,
          success: described(Project.ManagedWorkspace, "Created managed workspace"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "project.create",
            summary: "Create a project",
            description: "Create a project directory in the managed workspace root.",
          }),
        ),
        HttpApiEndpoint.get("managed", `${root}/managed`, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(Project.ManagedWorkspace), "List of managed workspaces"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "project.managed",
            summary: "List managed workspaces",
            description: "List shared workspace directories managed by this OpenCode server.",
          }),
        ),
        HttpApiEndpoint.get("managedRoot", `${root}/managed/root`, {
          query: WorkspaceRoutingQuery,
          success: described(Project.ManagedWorkspaceRoot, "Managed workspace root"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "project.managedRoot",
            summary: "Get managed workspace root",
            description: "Get the root directory that contains server-managed workspaces.",
          }),
        ),
        HttpApiEndpoint.get("managedStorage", `${root}/managed/storage`, {
          query: WorkspaceRoutingQuery,
          success: described(Project.ManagedStorage, "Managed workspace storage"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "project.managedStorage",
            summary: "Get managed workspace storage",
            description: "Get filesystem storage capacity for the configured managed workspace path.",
          }),
        ),
        HttpApiEndpoint.delete("deleteManaged", `${root}/managed/:workspaceID`, {
          params: { workspaceID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Project.ManagedWorkspace, "Deleted managed workspace"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        })
          .middleware(InstanceContextMiddleware)
          .annotateMerge(
            OpenApi.annotations({
              identifier: "project.deleteManaged",
              summary: "Delete managed workspace",
              description: "Delete a shared managed workspace, its directory, and its sessions.",
            }),
          ),
        HttpApiEndpoint.get("current", `${root}/current`, {
          query: WorkspaceRoutingQuery,
          success: described(Project.Info, "Current project information"),
        })
          .middleware(ProjectContextMiddleware)
          .annotateMerge(
            OpenApi.annotations({
              identifier: "project.current",
              summary: "Get current project",
              description: "Retrieve the currently active project that OpenCode is working with.",
            }),
          ),
        HttpApiEndpoint.post("initGit", `${root}/git/init`, {
          query: WorkspaceRoutingQuery,
          success: described(Project.Info, "Project information after git initialization"),
        })
          .middleware(InstanceContextMiddleware)
          .annotateMerge(
            OpenApi.annotations({
              identifier: "project.initGit",
              summary: "Initialize git repository",
              description: "Create a git repository for the current project and return the refreshed project info.",
            }),
          ),
        HttpApiEndpoint.patch("update", `${root}/:projectID`, {
          params: { projectID: ProjectV2.ID },
          query: WorkspaceRoutingQuery,
          payload: UpdatePayload,
          success: described(Project.Info, "Updated project information"),
          error: [HttpApiError.BadRequest, ProjectNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "project.update",
            summary: "Update project",
            description: "Update project properties such as name, icon, and commands.",
          }),
        ),
        HttpApiEndpoint.get("directories", `${root}/:projectID/directories`, {
          params: { projectID: ProjectV2.ID },
          query: WorkspaceRoutingQuery,
          success: described(ProjectV2.Directories, "Project directories"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "project.directories",
            summary: "List project directories",
            description: "List known local absolute directories for a project.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "project",
          description: "Experimental HttpApi project routes.",
        }),
      )
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
