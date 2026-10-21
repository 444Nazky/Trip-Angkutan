# Project Guidelines - Trip Angkutan

## graphify Usage
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists
- Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts
- After modifying code, run `graphify update .` to keep the graph current

## CSS Variables - CRITICAL RULES

### DO NOT USE UNDEFINED CSS VARIABLES
Before using any CSS variable in inline styles or component CSS:
1. Always verify the variable is defined in the global styles (index.html, global CSS files, or Tailwind config)
2. If a variable is not defined, use hardcoded values instead
3. Common safe colors: `#3B82F6` (blue-500), `#10B981` (green-500), `#EF4444` (red-500)

### Known Safe CSS Variables
- Colors defined in Tailwind config are safe to use via Tailwind classes
- Custom CSS variables should be defined in `:root` or in component styles

### Example - CORRECT
```tsx
// GOOD - Using hardcoded color
<div style={{ background: '#3B82F6' }}>

// GOOD - Using Tailwind class
<div className="bg-blue-500">

// GOOD - Only if --admin-accent is defined in global CSS
<div style={{ background: 'var(--admin-accent)' }}>
```

### Example - INCORRECT (causes silent failures)
```tsx
// BAD - var(--admin-accent) is NOT defined anywhere
<div style={{ background: 'var(--admin-accent)' }}>
```

## UI/UX Guidelines

### Emoji Usage
- Do NOT use emojis in the UI interface
- Use plain text or icons from lucide-react instead

### Text Separators
- Use `-` (dash) instead of `·` (middle dot) for text separators

### Sidebar Navigation
- "Laporan" (Reports) should be the first/primary menu item
- Remove redundant tabs (like separate Dashboard) when their content is available in Reports

## Code Quality

### Before Deploying
1. Run TypeScript compiler: `npx tsc --noEmit --skipLibCheck`
2. Check for any undefined CSS variables in inline styles
3. Verify all imports are correct
4. Test the specific feature that was modified

### Backend Changes (Supabase Edge Functions)
When modifying backend handlers:
1. Deploy to Supabase: `supabase functions deploy api --project-ref bmiruktfruunegtbydyw`
2. Test the API endpoint directly
3. Check Supabase logs for errors

### Frontend Changes
When modifying frontend:
1. Build: `npm run build`
2. Copy to admin directory: `cp -r www/* /path/to/admin-www/`
3. Test in browser (clear cache if needed)

## Common Issues and Solutions

### Issue: Chart/graph not displaying
- Check if CSS variables used in `conic-gradient`, `linear-gradient`, or inline styles are defined
- Use browser DevTools to inspect elements and check computed styles

### Issue: Changes not appearing after deploy
- Clear browser cache (Ctrl+Shift+R or Cmd+Shift+R)
- Check if the old version is being served from cache
- Verify the build output contains the new code

### Issue: TypeScript errors
- Run `npx tsc --noEmit --skipLibCheck` to identify issues
- Ensure all type definitions are correct
