import os
import sys

# Add project root directory to Python's search path so 'backend' is discoverable
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend.app import app