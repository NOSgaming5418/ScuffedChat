# Deploying to Vercel

This guide explains how to deploy ScuffedSnap to Vercel.

## Prerequisites

1. A [Vercel account](https://vercel.com/signup)
2. [Vercel CLI](https://vercel.com/docs/cli) installed (optional, for command-line deployment)
3. Your Supabase configuration set up

## Deployment Methods

### Method 1: Deploy via Vercel Dashboard (Recommended)

1. Push your code to a Git repository (GitHub, GitLab, or Bitbucket)
2. Visit [vercel.com](https://vercel.com) and log in
3. Click "Add New Project"
4. Import your repository
5. Vercel will automatically detect the `vercel.json` configuration
6. Add your environment variables (if any):
   - Go to Project Settings → Environment Variables
   - Add any required Supabase credentials or API keys
7. Click "Deploy"

### Method 2: Deploy via Vercel CLI

```bash
# Install Vercel CLI globally
npm i -g vercel

# Login to Vercel
vercel login

# Deploy from your project directory
cd /path/to/ScuffedSnap
vercel

# For production deployment
vercel --prod
```

## Configuration Files

The following files have been created for Vercel deployment:

- **`vercel.json`**: Configures the Vercel build and routing
- **`api/index.go`**: Serverless function entry point
- **`.vercelignore`**: Specifies files to exclude from deployment

## Important Notes

1. **Database**: Make sure your Supabase database is accessible from Vercel's servers
2. **Environment Variables**: Set any required environment variables in the Vercel dashboard
3. **Static Files**: All files in the `static/` directory will be served
4. **WebSockets**: Note that Vercel serverless functions have limitations with WebSockets. For real-time features, consider using Supabase Realtime or a separate WebSocket server

## Post-Deployment

After deployment, Vercel will provide you with:
- A production URL (e.g., `your-project.vercel.app`)
- Preview URLs for each branch/commit
- Automatic HTTPS certificates

## Troubleshooting

- **Build Errors**: Check the Vercel build logs in the dashboard
- **Runtime Errors**: Check the Function Logs in the Vercel dashboard
- **Static Files Not Loading**: Ensure paths in your HTML/CSS/JS are relative or absolute from root

## Local Testing

To test the serverless function locally:

```bash
# Install Vercel CLI
npm i -g vercel

# Run development server
vercel dev
```

This will start a local server that simulates the Vercel environment.
