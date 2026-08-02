"""One-off script to create the initial admin user in Cosmos DB."""
import uuid
from dotenv import load_dotenv

load_dotenv()

from auth import hash_password
from store import user_store


def create_admin_user(email: str, password: str, display_name: str, role: str = "System Administrator"):
    try:
        if user_store.get_by_email(email):
            print(f"A user with email {email} already exists.")
            return None
        uid = str(uuid.uuid4())
        user_store.add(
            {
                "id": uid,
                "email": email,
                "displayName": display_name,
                "role": role,
                "passwordHash": hash_password(password),
            }
        )
        print(f"Successfully created new user: {uid}")
        return uid
    except Exception as e:
        print(f"Error creating user: {e}")
        return None

if __name__ == "__main__":
    email = "admin@womgroup.com"
    password = "SecurePassword123!"
    display_name = "System Administrator"
    
    print(f"Creating admin account: {email}...")
    create_admin_user(email, password, display_name)
    print("\nDone! You can now log in with these credentials.")
