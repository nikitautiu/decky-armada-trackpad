import logging

DECKY_PLUGIN_SETTINGS_DIR: str
DECKY_PLUGIN_RUNTIME_DIR: str
DECKY_PLUGIN_LOG_DIR: str
DECKY_PLUGIN_DIR: str
DECKY_USER: str
DECKY_USER_HOME: str
logger: logging.Logger

async def emit(event: str, *args: object) -> None: ...
