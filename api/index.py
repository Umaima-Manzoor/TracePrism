import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))     # path of var/task/api/index.py
# dirname twice = two directories to go in
# intert(0,..) = adds the root to python module search path

from backend.app import app