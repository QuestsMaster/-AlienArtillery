# HTTPS deployment

The PWA service worker, Home Screen installation, and offline cache require HTTPS (localhost is the development exception). The deployable directory is `dist/`; do not serve the source tree.

## GitHub Pages

1. Create or choose a GitHub repository only after obtaining approval for that external action.
2. Run `npm ci` and `npm run build` in CI.
3. Upload the resulting `dist/` directory as the GitHub Pages artifact and deploy it with the Pages workflow.
4. Configure Pages to use GitHub Actions as its source, then open the generated HTTPS URL in iPhone Safari.
5. After deployment, wait for `Готово к офлайн-игре` before asking Safari to Add to Home Screen.

The Vite base is relative, so the same `dist/` output works for either a repository subpath or a custom HTTPS domain. Publishing, repository creation, DNS changes, and external CI configuration are deliberately not performed by this repository.
