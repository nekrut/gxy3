import { describe, it, expect, beforeEach } from "vitest";
import {
  createPlan,
  getCurrentPlan,
  resetState,
  addStep,
  addWorkflowStep,
  linkInvocation,
  getWorkflowSteps,
  updateStepStatus,
} from "../extensions/galaxy-analyst/state";
import type { WorkflowStructure } from "../extensions/galaxy-analyst/types";

function makeWorkflowStructure(overrides?: Partial<WorkflowStructure>): WorkflowStructure {
  return {
    name: "RNA-seq PE",
    annotation: "Paired-end RNA-seq pipeline",
    version: 3,
    toolIds: [
      "toolshed.g2.bx.psu.edu/repos/devteam/fastqc/fastqc/0.74",
      "toolshed.g2.bx.psu.edu/repos/iuc/hisat2/hisat2/2.2.1",
      "toolshed.g2.bx.psu.edu/repos/iuc/featurecounts/featurecounts/2.0.3",
    ],
    toolNames: ["fastqc", "hisat2", "featurecounts"],
    inputLabels: ["PE reads", "Reference annotation"],
    outputLabels: ["Aligned BAM", "Count matrix"],
    stepCount: 5,
    ...overrides,
  };
}

describe("workflow state functions", () => {
  beforeEach(() => {
    resetState();
  });

  describe("addWorkflowStep", () => {
    it("creates correct step structure", () => {
      createPlan({ title: "Test", researchQuestion: "Q", dataDescription: "D", expectedOutcomes: [], constraints: [] });
      const ws = makeWorkflowStructure();

      const step = addWorkflowStep({
        workflowId: "wf-abc",
        trsId: "iwc-rnaseq-pe",
        workflowStructure: ws,
      });

      expect(step.id).toBe("1");
      expect(step.name).toBe("RNA-seq PE");
      expect(step.description).toBe("Paired-end RNA-seq pipeline");
      expect(step.status).toBe("pending");
      expect(step.execution.type).toBe("workflow");
      expect(step.execution.workflowId).toBe("wf-abc");
      expect(step.execution.trsId).toBe("iwc-rnaseq-pe");
      expect(step.workflowStructure).toBe(ws);
      expect(step.inputs).toHaveLength(2);
      expect(step.inputs[0].name).toBe("PE reads");
      expect(step.expectedOutputs).toEqual(["Aligned BAM", "Count matrix"]);
      expect(step.dependsOn).toEqual([]);
      expect(getCurrentPlan()!.steps).toHaveLength(1);
    });

    it("uses custom name and description when provided", () => {
      createPlan({ title: "Test", researchQuestion: "Q", dataDescription: "D", expectedOutcomes: [], constraints: [] });

      const step = addWorkflowStep({
        name: "Custom Name",
        description: "Custom desc",
        workflowId: "wf-abc",
        workflowStructure: makeWorkflowStructure(),
      });

      expect(step.name).toBe("Custom Name");
      expect(step.description).toBe("Custom desc");
    });

    it("assigns sequential IDs with existing steps", () => {
      createPlan({ title: "Test", researchQuestion: "Q", dataDescription: "D", expectedOutcomes: [], constraints: [] });
      addStep({ name: "S1", description: "D", executionType: "tool", inputs: [], expectedOutputs: [], dependsOn: [] });

      const step = addWorkflowStep({
        workflowId: "wf-abc",
        workflowStructure: makeWorkflowStructure(),
      });

      expect(step.id).toBe("2");
    });

    it("throws without active plan", () => {
      expect(() => addWorkflowStep({
        workflowId: "wf-abc",
        workflowStructure: makeWorkflowStructure(),
      })).toThrow("No active plan");
    });

    it("falls back to generic description when annotation is empty", () => {
      createPlan({ title: "Test", researchQuestion: "Q", dataDescription: "D", expectedOutcomes: [], constraints: [] });

      const step = addWorkflowStep({
        workflowId: "wf-abc",
        workflowStructure: makeWorkflowStructure({ annotation: undefined }),
      });

      expect(step.description).toBe("Run workflow: RNA-seq PE");
    });

    it("handles workflow with no labeled outputs", () => {
      createPlan({ title: "Test", researchQuestion: "Q", dataDescription: "D", expectedOutcomes: [], constraints: [] });

      const step = addWorkflowStep({
        workflowId: "wf-abc",
        workflowStructure: makeWorkflowStructure({ outputLabels: [] }),
      });

      expect(step.expectedOutputs).toEqual(["Workflow outputs from RNA-seq PE"]);
    });
  });

  describe("linkInvocation", () => {
    it("sets status and records invocation ID", () => {
      createPlan({ title: "Test", researchQuestion: "Q", dataDescription: "D", expectedOutcomes: [], constraints: [] });
      addWorkflowStep({ workflowId: "wf-abc", workflowStructure: makeWorkflowStructure() });

      const step = linkInvocation("1", "inv-xyz-789");

      expect(step.status).toBe("in_progress");
      expect(step.result).toBeTruthy();
      expect(step.result!.invocationId).toBe("inv-xyz-789");
    });

    it("throws for nonexistent step", () => {
      createPlan({ title: "Test", researchQuestion: "Q", dataDescription: "D", expectedOutcomes: [], constraints: [] });

      expect(() => linkInvocation("999", "inv-abc")).toThrow("Step 999 not found");
    });

    it("throws without active plan", () => {
      expect(() => linkInvocation("1", "inv-abc")).toThrow("No active plan");
    });
  });

  describe("getWorkflowSteps", () => {
    it("returns only in-progress workflow steps with invocations", () => {
      createPlan({ title: "Test", researchQuestion: "Q", dataDescription: "D", expectedOutcomes: [], constraints: [] });

      // Tool step (should not appear)
      addStep({ name: "FastQC", description: "D", executionType: "tool", inputs: [], expectedOutputs: [], dependsOn: [] });
      updateStepStatus("1", "in_progress");

      // Workflow step without invocation (should not appear)
      addWorkflowStep({ workflowId: "wf-1", workflowStructure: makeWorkflowStructure() });

      // Workflow step with invocation (should appear)
      addWorkflowStep({ workflowId: "wf-2", workflowStructure: makeWorkflowStructure({ name: "WF Two" }) });
      linkInvocation("3", "inv-active");

      // Completed workflow step (should not appear)
      addWorkflowStep({ workflowId: "wf-3", workflowStructure: makeWorkflowStructure({ name: "WF Three" }) });
      linkInvocation("4", "inv-done");
      updateStepStatus("4", "completed", {
        completedAt: new Date().toISOString(),
        invocationId: "inv-done",
        summary: "Done",
        qcPassed: true,
      });

      const active = getWorkflowSteps();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe("3");
      expect(active[0].result!.invocationId).toBe("inv-active");
    });

    it("returns empty with no plan", () => {
      expect(getWorkflowSteps()).toEqual([]);
    });

    it("returns empty when no workflow steps exist", () => {
      createPlan({ title: "Test", researchQuestion: "Q", dataDescription: "D", expectedOutcomes: [], constraints: [] });
      addStep({ name: "S1", description: "D", executionType: "tool", inputs: [], expectedOutputs: [], dependsOn: [] });

      expect(getWorkflowSteps()).toEqual([]);
    });
  });
});
