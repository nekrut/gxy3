import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getGalaxyConfig,
  extractWorkflowStructure,
  type GalaxyWorkflowResponse,
} from "../extensions/galaxy-analyst/galaxy-api";

describe("getGalaxyConfig", () => {
  const origUrl = process.env.GALAXY_URL;
  const origKey = process.env.GALAXY_API_KEY;

  afterEach(() => {
    if (origUrl !== undefined) process.env.GALAXY_URL = origUrl;
    else delete process.env.GALAXY_URL;
    if (origKey !== undefined) process.env.GALAXY_API_KEY = origKey;
    else delete process.env.GALAXY_API_KEY;
  });

  it("returns null when env vars missing", () => {
    delete process.env.GALAXY_URL;
    delete process.env.GALAXY_API_KEY;
    expect(getGalaxyConfig()).toBeNull();
  });

  it("returns null when only URL is set", () => {
    process.env.GALAXY_URL = "https://usegalaxy.org";
    delete process.env.GALAXY_API_KEY;
    expect(getGalaxyConfig()).toBeNull();
  });

  it("returns config when env vars set", () => {
    process.env.GALAXY_URL = "https://usegalaxy.org/";
    process.env.GALAXY_API_KEY = "test-key-123";

    const config = getGalaxyConfig();
    expect(config).not.toBeNull();
    expect(config!.url).toBe("https://usegalaxy.org");
    expect(config!.apiKey).toBe("test-key-123");
  });

  it("strips trailing slashes from URL", () => {
    process.env.GALAXY_URL = "https://usegalaxy.org///";
    process.env.GALAXY_API_KEY = "key";

    const config = getGalaxyConfig();
    expect(config!.url).toBe("https://usegalaxy.org");
  });
});

describe("extractWorkflowStructure", () => {
  function makeWorkflow(overrides?: Partial<GalaxyWorkflowResponse>): GalaxyWorkflowResponse {
    return {
      id: "wf-123",
      name: "RNA-seq PE",
      annotation: "Paired-end RNA-seq analysis pipeline",
      version: 3,
      steps: {
        "0": {
          id: "0",
          type: "data_input",
          tool_id: null,
          label: "PE reads",
          input_connections: {},
        },
        "1": {
          id: "1",
          type: "data_input",
          tool_id: null,
          label: "Reference annotation",
          input_connections: {},
        },
        "2": {
          id: "2",
          type: "tool",
          tool_id: "toolshed.g2.bx.psu.edu/repos/devteam/fastqc/fastqc/0.74",
          label: "FastQC",
          input_connections: { input_file: { id: 0 } },
        },
        "3": {
          id: "3",
          type: "tool",
          tool_id: "toolshed.g2.bx.psu.edu/repos/iuc/hisat2/hisat2/2.2.1",
          label: "HISAT2",
          input_connections: { input: { id: 0 } },
          workflow_outputs: [{ label: "Aligned BAM", output_name: "output" }],
        },
        "4": {
          id: "4",
          type: "tool",
          tool_id: "toolshed.g2.bx.psu.edu/repos/iuc/featurecounts/featurecounts/2.0.3",
          label: "featureCounts",
          input_connections: { alignment: { id: 3 } },
          workflow_outputs: [{ label: "Count matrix", output_name: "output" }],
        },
      },
      ...overrides,
    };
  }

  it("parses tool steps, inputs, outputs correctly", () => {
    const ws = extractWorkflowStructure(makeWorkflow());

    expect(ws.name).toBe("RNA-seq PE");
    expect(ws.annotation).toBe("Paired-end RNA-seq analysis pipeline");
    expect(ws.version).toBe(3);
    expect(ws.stepCount).toBe(5);
    expect(ws.inputLabels).toEqual(["PE reads", "Reference annotation"]);
    expect(ws.toolIds).toHaveLength(3);
    expect(ws.toolIds).toContain("toolshed.g2.bx.psu.edu/repos/devteam/fastqc/fastqc/0.74");
    expect(ws.toolNames).toContain("fastqc");
    expect(ws.toolNames).toContain("hisat2");
    expect(ws.toolNames).toContain("featurecounts");
    expect(ws.outputLabels).toEqual(["Aligned BAM", "Count matrix"]);
  });

  it("handles workflows with no labeled outputs", () => {
    const wf = makeWorkflow();
    // Remove all workflow_outputs
    for (const step of Object.values(wf.steps)) {
      delete step.workflow_outputs;
    }

    const ws = extractWorkflowStructure(wf);
    expect(ws.outputLabels).toEqual([]);
    expect(ws.toolIds).toHaveLength(3);
  });

  it("handles workflows with no annotation", () => {
    const wf = makeWorkflow({ annotation: "" });
    const ws = extractWorkflowStructure(wf);
    expect(ws.annotation).toBeUndefined();
  });

  it("handles input steps without labels", () => {
    const wf = makeWorkflow();
    // Remove label from first input, keep annotation
    delete (wf.steps["0"] as any).label;
    wf.steps["0"].annotation = "Sequencing reads";

    const ws = extractWorkflowStructure(wf);
    expect(ws.inputLabels[0]).toBe("Sequencing reads");
  });
});
