import secrets
import string


def generate_referral_code(length: int = 8) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def payment_reference(request_id: str) -> str:
    return f"MM-{request_id.replace('-', '')[:6].upper()}"
