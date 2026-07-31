import type { EnvironmentId, OrchestrationThreadActivity } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { FileDownIcon, LoaderIcon } from "lucide-react";
import { memo, useCallback, useState } from "react";

import { Button } from "../components/ui/button";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { projectEnvironment } from "../state/projects";
import { useAtomCommand } from "../state/use-atom-command";
import {
  buildGrillmeHandoffFilename,
  buildGrillmeMarkdown,
  deriveGrillTranscript,
} from "./grillTranscript";

interface GrillHandoffButtonProps {
  environmentId: EnvironmentId;
  workspaceRoot: string;
  prompt: string;
  activities: ReadonlyArray<OrchestrationThreadActivity>;
}

export const GrillHandoffButton = memo(function GrillHandoffButton({
  environmentId,
  workspaceRoot,
  prompt,
  activities,
}: GrillHandoffButtonProps) {
  const [isSaving, setIsSaving] = useState(false);
  const writeProjectFile = useAtomCommand(projectEnvironment.writeFile, {
    reportFailure: false,
  });

  const handleHandoff = useCallback(() => {
    if (isSaving) return;

    const relativePath = buildGrillmeHandoffFilename();
    const contents = buildGrillmeMarkdown({
      prompt,
      transcript: deriveGrillTranscript(activities),
    });

    setIsSaving(true);
    void (async () => {
      const result = await writeProjectFile({
        environmentId,
        input: {
          cwd: workspaceRoot,
          relativePath,
          contents,
        },
      });
      setIsSaving(false);

      if (result._tag === "Success") {
        toastManager.add({
          type: "success",
          title: "Handoff saved",
          description: result.value.relativePath,
        });
        return;
      }

      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not create handoff",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  }, [activities, environmentId, isSaving, prompt, workspaceRoot, writeProjectFile]);

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={handleHandoff}
      disabled={isSaving}
      aria-label="Save this grilling session as Markdown"
    >
      {isSaving ? <LoaderIcon className="animate-spin" /> : <FileDownIcon />}
      Handoff
    </Button>
  );
});
