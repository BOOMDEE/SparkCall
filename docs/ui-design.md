# SparkCall interface design

## Product job

The authenticated dashboard should help a person decide how to start a private call with minimal hesitation: identify their SparkCall number, reach a contact or enter a number, and understand whether calling is available. Call history and configuration remain accessible but secondary. The interface must not invent demo metrics, presence, contacts, or setup progress.

## Visual rules

- Use the locally bundled Inter Variable typeface, neutral black/white/gray surfaces, strong readable hierarchy, deliberate spacing/alignment, and thin borders only where they clarify grouping.
- Keep the information dense enough to reduce navigation and decision time. Prefer a direct workspace shell and aligned rows over decorative hero areas, nested cards, gradients, oversized empty whitespace, or marketing copy in authenticated views.
- Use the installed `lucide-react` icons as restrained monochrome inline SVG line icons. Icon-only controls require an accessible name; purely decorative icons are hidden from assistive technology.
- Preserve high-contrast states, keyboard focus, screen-reader announcements, responsive navigation, dark mode, loading/error/empty states, and the existing privacy/security semantics.
- Ship English and Simplified Chinese translations for static application copy. User data, product names, SparkCall numbers, timestamps, API identifiers, and the exact footer attribution remain unchanged.
- Show `Design with ❤️ by @BOOMDEE` in the footer on all site sections, exactly as written in both languages.

## Reusable design prompt

> Redesign the existing SparkCall browser-calling workspace without changing its React/Vite/TypeScript stack, routes, APIs, security properties, or working interactions. Its audience needs to make and manage private browser voice calls with less hesitation. Make the authenticated overview immediately answer: who am I calling from, can I reach a contact or enter a number, and what needs attention? Use locally hosted Inter Variable; a calm black/white/gray palette; clear typographic hierarchy; precise alignment and consistent spacing; thin, useful dividers; compact SVG line icons; responsive light/dark presentation; and bilingual English/Simplified Chinese strings. Avoid decorative gradients, generic SaaS hero panels, unnecessary nested cards, fabricated sample metrics, and Vercel branding/fonts. Retain and translate every existing feature, form, action, loading/error/empty state, accessibility behavior, and privacy notice. Use real API data and state only.

## References

- Vercel, [“Maximizing outputs with v0: From UI generation to code creation”](https://vercel.com/blog/maximizing-outputs-with-v0-from-ui-generation-to-code-creation): prompts improve when they specify component functionality, design preferences, technology, and product context.
- Vercel, [Geist Design System](https://vercel.com/geist/introduction): a system connects colors, typography, materials, layout, and reusable components. SparkCall uses these categories as inspiration but does not use Vercel branding or the Geist typeface.
- Vercel, [Design](https://vercel.com/design): guidance emphasizes reader/user needs, hierarchy, information ordering, and avoiding decoration that obscures the task. Its report-specific requirements are not copied as product UI requirements.
- Refero, [Dashboard design prompts](https://styles.refero.design/ai-agents/dashboard-design-prompts): a third-party collection of dashboard visual references; ideas are adapted, not treated as official Vercel guidance.

## Screenshot policy

Repository screenshots should be genuine captures of the locally running application with synthetic data. Do not include real user accounts, credentials, or private call records. A proposed dashboard screenshot is preview-only until the project owner approves the exact image.
