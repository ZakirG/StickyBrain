---
description: Brainlift Template
globs: *.md
---
<rule>
name: brainlift_template
description: Enforces the standard Brainlift template for knowledge management
filters:
  - type: file_extension
    pattern: "\\.md$"
actions:
  - type: suggest
    message: |
      Your Brainlift markdown file should follow this template:
      ```markdown
      - [Topic Name]
        - Purpose
          - Not in scope
            [List what is not covered]
          - In scope
            [List what is covered]
        - Experts
          - Expert 1
            - Who: [titles and "claims to fame"]
            - Focus: [topics they are expert in]
            - Why Follow: [main views of the expert and how they are valuable for this BrainLift]
            - Where: [how to find the expert - include links to twitter, blog, books, papers]
          - Expert 2
            - Who: [titles and "claims to fame"]
            - Focus: [topics they are expert in]
            - Why Follow: [main views of the expert and how they are valuable for this BrainLift]
            - Where: [how to find the expert - include links to twitter, blog, books, papers]
          [Additional experts follow the same template] 
        - SpikyPOVs
          - Truths
            - Spiky POV Truth 1: [Description]
            - Spiky POV Truth 2: [Description]
            - Spiky POV Truth 3: [Description]
          - Myths
            - Spiky POV Myth 1: [Description]
            - Spiky POV Myth 2: [Description]
            - Spiky POV Myth 3: [Description]
        - Knowledge Tree/Categories
          - Category 1
            - Summary: [Category summary]
        - Sources
          - [Source 1 name]
            - Summary: [Source summary]
            - Key Facts:
              - [Fact 1]
              - [Fact 2]
            - Link: [Source link]
            - Insights (optional): [Surprising, contrarian, or new learnings]
          
          - Insights on Category 1
            - Insight 1: [Combined learning insight]
            - Insight 2: [Combined learning insight]
      ```
      Guidelines:
      1. Use consistent indentation (2 spaces) for each level
      2. Each level starts with a hyphen (-)
      3. Use colons (:) to separate labels from content
      4. The Purpose section must include both in-scope and out-of-scope items
      5. Each expert entry must include all four subsections: Who, Focus, Why Follow, and Where
      6. Sources must include at minimum a summary and link
      7. Category insights are required, while source-specific insights are optional
examples:
  - input: |
      - AI Safety
        - Purpose
          - Not in scope
            - Technical implementation details
            - Historical AI developments
          - In scope
            - Current AI safety frameworks
            - Key researchers and their positions
            - Major concerns and proposed solutions
        [Rest of template follows...]
    output: "Valid Brainlift template"
metadata:
  priority: medium
  version: 1.0
</rule> 