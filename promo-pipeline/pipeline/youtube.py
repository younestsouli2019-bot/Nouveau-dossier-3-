"""YouTube Data API upload via the operator's own OAuth credentials (never committed)."""
import os


def upload(video: str, meta: dict) -> str:
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload

    creds = Credentials(
        None,
        refresh_token=os.environ["YT_REFRESH_TOKEN"],
        client_id=os.environ["YT_CLIENT_ID"],
        client_secret=os.environ["YT_CLIENT_SECRET"],
        token_uri="https://oauth2.googleapis.com/token",
    )
    creds.refresh(Request())
    yt = build("youtube", "v3", credentials=creds)
    body = {
        "snippet": {"title": meta["title"], "description": meta["description"],
                    "tags": meta["tags"]},
        "status": {"privacyStatus": os.environ.get("YT_PRIVACY", "private")},
    }
    r = yt.videos().insert(part="snippet,status", body=body,
                           media_body=MediaFileUpload(video, resumable=True)).execute()
    return f"https://youtu.be/{r['id']}"
