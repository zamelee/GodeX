# yaml_ops.py - godex.yaml read/write operations
import yaml
from pathlib import Path
from typing import Dict, List, Optional, Any

class YamlOps:
    def __init__(self, config_path: str):
        self.config_path = Path(config_path)
        self._data: Optional[Dict] = None
    
    def load(self) -> Dict[str, Any]:
        """Load and parse godex.yaml"""
        if not self.config_path.exists():
            raise FileNotFoundError(f"Config not found: {self.config_path}")
        
        with open(self.config_path, 'r', encoding='utf-8') as f:
            self._data = yaml.safe_load(f)
        
        return self._data
    
    def save(self, data: Dict[str, Any]) -> None:
        """Save data back to godex.yaml"""
        with open(self.config_path, 'w', encoding='utf-8') as f:
            yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
    
    def get_providers(self) -> List[str]:
        """Get list of configured providers"""
        if self._data is None:
            self.load()
        return list(self._data.get('providers', {}).keys())
    
    def get_provider_config(self, provider_name: str) -> Optional[Dict[str, Any]]:
        """Get specific provider config"""
        if self._data is None:
            self.load()
        return self._data.get('providers', {}).get(provider_name)
    
    def get_enabled_models(self) -> List[Dict[str, Any]]:
        """Get list of enabled models with their config"""
        if self._data is None:
            self.load()
        return self._data.get('models', {}).get('enabled', [])
    
    def update_model(self, provider: str, model: str, updates: Dict[str, Any]) -> bool:
        """Update a model configuration"""
        if self._data is None:
            self.load()
        
        enabled_models = self._data.get('models', {}).get('enabled', [])
        
        for model_config in enabled_models:
            if model_config.get('provider') == provider and model_config.get('model') == model:
                model_config.update(updates)
                self.save(self._data)
                return True
        
        return False
