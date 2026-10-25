import uuid

# IDs are prefixed strings (see docs: spec, Data section), e.g. "usr_<hex>".


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"
