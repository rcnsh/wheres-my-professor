"""
Populate Weaviate Cloud with face embeddings
One-time script to set up your database
"""

import weaviate
from weaviate.classes.config import Configure, Property, DataType, VectorDistances
from weaviate.auth import AuthApiKey
from deepface import DeepFace
from pathlib import Path
from typing import Dict, List, Optional, Any
from tqdm import tqdm
import os

class FaceRegistrationCloud:
    """Populate Weaviate Cloud with face embeddings"""
    
    def __init__(
        self, 
        cluster_url: str,
        api_key: str
    ):
        """
        Initialize Weaviate Cloud connection
        
        Args:
            cluster_url: Your Weaviate Cloud cluster URL 
                         (e.g., "https://my-cluster-abc123.weaviate.network")
            api_key: Your Weaviate Cloud API key
        """
        # Connect to Weaviate Cloud
        self.client = weaviate.connect_to_weaviate_cloud(
            cluster_url=cluster_url,
            auth_credentials=AuthApiKey(api_key)
        )
        
        self.collection_name = "FaceEmbedding"
        self.model_name = "Facenet512"
        
        print(f"✅ Connected to Weaviate Cloud")
        print(f"   Cluster: {cluster_url}")
        
    def setup_schema(self):
        """Create Weaviate schema for face embeddings"""
        try:
            # Delete existing collection if it exists
            if self.client.collections.exists(self.collection_name):
                self.client.collections.delete(self.collection_name)
                print(f"🗑️  Deleted existing collection")
            
            # Create collection
            collection = self.client.collections.create(
                name=self.collection_name,
                properties=[
                    Property(name="personName", data_type=DataType.TEXT),
                ],
                vectorizer_config=Configure.Vectorizer.none(),
                vector_index_config=Configure.VectorIndex.hnsw(
                    distance_metric=VectorDistances.COSINE,
                    ef_construction=128,
                    max_connections=64
                )
            )
            
            print(f"✅ Created collection: {self.collection_name}")
            return collection
            
        except Exception as e:
            print(f"❌ Schema setup error: {str(e)}")
            raise
    
    def extract_embedding(self, image_path: str) -> Optional[List[float]]:
        """Extract face embedding using DeepFace"""
        try:
            result = DeepFace.represent(
                img_path=image_path,
                model_name=self.model_name,
                detector_backend="retinaface",
                enforce_detection=True,
                align=True
            )
            
            if result and len(result) > 0:
                return result[0]["embedding"]
            return None
            
        except Exception as e:
            print(f"  ⚠️  Failed: {Path(image_path).name} - {str(e)}")
            return None
    
    def register_person(
        self,
        person_name: str,
        image_folder: str,
        max_photos: int = 50,
    ) -> Dict[str, Any]:
        """Register a person with multiple photos"""
        folder = Path(image_folder)
        
        if not folder.exists():
            return {"error": f"Folder not found: {image_folder}", "successful": 0, "failed": 0}
        
        # Collect images
        valid_extensions = {'.jpg', '.jpeg', '.png', '.bmp', '.webp'}
        image_paths = []
        for ext in valid_extensions:
            image_paths.extend(folder.glob(f"*{ext}"))
            image_paths.extend(folder.glob(f"*{ext.upper()}"))
        
        image_paths = sorted(image_paths)[:max_photos]
        
        if not image_paths:
            return {"error": "No images found", "successful": 0, "failed": 0, "errors": []}
        
        print(f"\n📸 {person_name} - {len(image_paths)} photos")
        
        collection = self.client.collections.get(self.collection_name)
        
        results = {"successful": 0, "failed": 0, "errors": []}
        
        # Process in batches for efficiency
        batch_size = 10
        
        for i in range(0, len(image_paths), batch_size):
            batch = image_paths[i:i + batch_size]
            
            for img_path in tqdm(batch, desc=f"  Batch {i//batch_size + 1}", leave=False):
                try:
                    embedding = self.extract_embedding(str(img_path))
                    
                    if embedding is None:
                        results["failed"] += 1
                        continue
                    
                    collection.data.insert(
                        properties={
                            "personName": person_name,
                        },
                        vector=embedding
                    )
                    
                    results["successful"] += 1
                    
                except Exception as e:
                    results["failed"] += 1
                    results["errors"].append(f"{img_path.name}: {str(e)}")
        
        print(f"  ✅ {results['successful']}/{len(image_paths)} photos registered")
        if results["failed"] > 0:
            print(f"  ⚠️  Failed: {results['failed']}")
        
        return results
    
    def register_batch(
        self, 
        people: Dict[str, str],
        max_photos_per_person: int = 50
    ):
        """Register multiple people
        
        Args:
            people: Dict mapping person name to their image folder path
            max_photos_per_person: Maximum photos to register per person
        """
        print(f"\n{'='*60}")
        print(f"BATCH REGISTRATION - {len(people)} people")
        print(f"{'='*60}")
        
        total = {"people": len(people), "photos": 0, "successful": 0, "failed": 0}
        
        for person_name, folder in people.items():
            result = self.register_person(
                person_name=person_name,
                image_folder=folder,
                max_photos=max_photos_per_person,
            )
            
            total["photos"] += result["successful"] + result["failed"]
            total["successful"] += result["successful"]
            total["failed"] += result["failed"]
        
        print(f"\n{'='*60}")
        print(f"✅ REGISTRATION COMPLETE")
        print(f"{'='*60}")
        print(f"People: {total['people']}")
        print(f"Total photos: {total['photos']}")
        print(f"Successful: {total['successful']}")
        print(f"Failed: {total['failed']}")
        
        return total
    
    def get_stats(self):
        """Get database statistics"""
        collection = self.client.collections.get(self.collection_name)
        aggregate = collection.aggregate.over_all(total_count=True)
        
        print(f"\n📊 Database Statistics:")
        print(f"   Total embeddings: {aggregate.total_count}")
        
        return {"total_embeddings": aggregate.total_count}
    
    def close(self):
        self.client.close()
        print("✅ Closed Weaviate connection")


if __name__ == "__main__":
    # ==========================================================================
    # CONFIGURATION - Replace with your Weaviate Cloud credentials
    # ==========================================================================
    
    WEAVIATE_CLUSTER_URL = "dxki3elrrmeleb8xnujsjw.c0.europe-west3.gcp.weaviate.cloud"
    
    WEAVIATE_API_KEY = "V1I3T29EdkZyRE1GOUNsOV9ITnh5cWpybGFuRUsrZlBUR2NiZlpwMzZ6bGRVQXF5d3JlUi9oRjUwenhrPV92MjAw" # Replace this or use environment variable
    
    
    # ==========================================================================
    # PEOPLE TO REGISTER
    # Maps person name -> folder of their photos
    # ==========================================================================
    
    people_to_register = {
        "Derrick Lim": "./photos/derrick/",
        "Ewan Wormald": "./photos/ewan/",
        "Dan Banfield": "./photos/dan/",
    }
    
    # ==========================================================================
    # RUN REGISTRATION
    # ==========================================================================
    
    try:
        # Initialize
        db = FaceRegistrationCloud(
            cluster_url=WEAVIATE_CLUSTER_URL,
            api_key=WEAVIATE_API_KEY
        )
        
        # Setup schema
        db.setup_schema()
        
        # Register all people (50 photos each max)
        db.register_batch(people_to_register, max_photos_per_person=50)
        
        # Show stats
        db.get_stats()
        
        # Close connection
        db.close()
        
        print("\n🎉 All done! Your Weaviate Cloud database is ready.")
        
    except Exception as e:
        print(f"\n❌ Error: {str(e)}")
        print("\nPlease check:")
        print("1. Your cluster URL is correct, it is: ", WEAVIATE_CLUSTER_URL)
        print("2. Your API key is valid, it is: ", WEAVIATE_API_KEY)
        print("3. Your cluster is running")
        exit(1)
