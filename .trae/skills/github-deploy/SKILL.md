---
name: "github-deploy"
description: "Deploys websites using GitHub Actions and GitHub Desktop. Invoke when user needs to push changes to GitHub for website deployment."
---

# GitHub Deploy Skill

This skill handles website deployment through GitHub's ecosystem, including GitHub Desktop and GitHub Actions workflows.

## Capabilities

- **GitHub Desktop Integration**: Uses GitHub Desktop to resolve git lock issues and manage commits
- **GitHub Actions Deployment**: Triggers deployment workflows for static sites
- **Repository Management**: Handles git operations through GitHub's tools
- **Deployment Verification**: Monitors deployment status and provides feedback

## When to Invoke

Invoke this skill when:
- User needs to deploy a website to GitHub Pages
- Git lock issues prevent normal git operations
- GitHub Desktop is available as an alternative to command-line git
- Website deployment needs to be triggered via GitHub Actions
- User mentions "deploy", "push to GitHub", or "GitHub Desktop"

## Deployment Process

1. **Resolve Git Issues**: Uses GitHub Desktop to bypass command-line git locks
2. **Stage Changes**: Identifies website-related files that need deployment
3. **Commit Changes**: Creates commits with appropriate messages
4. **Push to Repository**: Uploads changes to trigger GitHub Actions
5. **Monitor Deployment**: Tracks deployment progress through GitHub Actions

## Supported Deployment Types

- **Static Sites**: GitHub Pages deployment via `.github/workflows/deploy-pages.yml`
- **Docker Deployments**: Container-based deployments via `.github/workflows/site-deploy.yml`
- **Custom Workflows**: Any GitHub Actions workflow configured for deployment

## Integration with GitHub Desktop

When git command-line tools are locked or restricted, this skill leverages GitHub Desktop's GUI interface to:
- Bypass file system restrictions
- Handle repository operations safely
- Provide visual feedback on changes
- Manage branches and commits intuitively