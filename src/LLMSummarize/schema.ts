export const chunkSchema = {
  type: "object",
  properties: {
    // per-chunk topics
    categories: { type: "array", items: { type: "string" } },

    dialogs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          order: { type: "integer" },
          summary: { type: "string" },
          soft_language: { type: "string" }
        },
        required: ["order"]
      }
    },

    middle_summary: {
      type: "object",
      properties: {
        based_on_orders: { type: "array", items: { type: "integer" } },
        summary: { type: "string" }
      },
      required: ["based_on_orders", "summary"]
    },

    terms: {
      type: "array",
      items: {
        type: "object",
        properties: { term: { type: "string" }, definition: { type: "string" } },
        required: ["term", "definition"]
      }
    },

    keywords: {
      type: "array",
      items: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          priority: { type: "string", enum: ["high","medium","low"] }
        },
        required: ["keyword", "priority"]
      }
    },

    participants: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, summary: { type: "string" } },
        required: ["name", "summary"]
      }
    },

    outline: { type: "array", items: { type: "string" } }
  },
  required: ["middle_summary", "categories"]
} as const;

export const reduceSchema = {
  type: "object",
  properties: {
    // final headline
    title: { type: "string" },

    // final topics list for the whole meeting
    categories: { type: "array", items: { type: "string" } },

    summary: {
      type: "object",
      properties: {
        based_on_orders: { type: "array", items: { type: "integer" } },
        summary: { type: "string" }
      },
      required: ["based_on_orders", "summary"]
    },

    soft_summary: {
      type: "object",
      properties: {
        based_on_orders: { type: "array", items: { type: "integer" } },
        summary: { type: "string" }
      },
      required: ["based_on_orders", "summary"]
    },

    description: { type: "string" },

    keywords: {
      type: "array",
      items: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          priority: { type: "string", enum: ["high","medium","low"] }
        },
        required: ["keyword", "priority"]
      }
    }
  },
  required: ["summary", "soft_summary", "title", "categories"]
} as const;
