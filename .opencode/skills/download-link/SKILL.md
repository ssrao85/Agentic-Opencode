---
name: download-link
description: Generate an OpenCode /file/download URL when the user asks for a download link, file link, artifact link, or wants to download a generated file from the workspace. Use for files under /all-workspaces or the active OpenCode workspace; do not use for deployed web apps under /apps.
---

# Download Link

Use this skill when the user asks for a link to download a file that already
exists in the OpenCode workspace, such as a generated report, spreadsheet,
archive, document, image, PDF, or source file.

## Workflow

1. Find and verify the requested file. If the user gives only a filename, search
   the active workspace for an exact match.
2. Choose the server-visible `directory`:
   - for `/all-workspaces/<workspace-id>/...`, use `/all-workspaces/<workspace-id>`
   - otherwise, use the file's parent directory
3. Choose `path` as the file path relative to `directory`.
4. Generate a same-origin Markdown link. Do not include an absolute host.

Encode query parameters with the runtime's standard URL utilities.

The output should look like this:

```text
/file/download?directory=%2Fall-workspaces%2F<workspace-id>&path=reports%2Foutput.xlsx
```

Return it as:

```markdown
[Download output.xlsx](/file/download?directory=...)
```

## Notes

- `404 Not Found` means the path is not visible to the running OpenCode server.
- The endpoint returns bytes and MIME type. It does not force
  `Content-Disposition: attachment`, so some browsers may preview supported file
  types instead of opening a save dialog.
