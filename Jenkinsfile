pipeline {
  agent any

  environment {
    IMAGE_NAME = 'meepo-replicate'
    DOCKERHUB_NAMESPACE = 'quantumteknologi'
    GIT_REPO = 'meepo-replicate'
    GIT_BRANCH = 'main'
    GIT_CREDENTIAL = 'meepo-autobot'
    ENV_FILE_CREDENTIAL = 'meepo-replicate-key'
    REGISTRY_CREDENTIAL = 'dockerhub-qtn'
    RANCHER_TOKEN_CREDENTIAL = 'meepo-rancher-secret'
    RANCHER_PROJECT_ID = 'local:p-ngpnh'
    RANCHER_URL = 'https://dev-rancher.quantumteknologi.com'
    RANCHER_NAMESPACE = 'meepo-replicate'
    RANCHER_DEPLOYMENT_NAME = 'meepo-replicate'
  }

  options {
    skipDefaultCheckout(true)
  }

  stages {

    stage('Checkout') {
      steps {
        git branch: "${env.GIT_BRANCH}", credentialsId: "${env.GIT_CREDENTIAL}", url: "https://github.com/QTN-DEV/${env.GIT_REPO}.git"
        sh 'echo "Checked out branch: $(git rev-parse --abbrev-ref HEAD)"'
      }
    }

    stage('Set Commit Hash Tag') {
      steps {
        script {
          def COMMIT_HASH = sh(script: "git rev-parse --short HEAD", returnStdout: true).trim()
          echo "Commit Hash: ${COMMIT_HASH}"

          env.IMAGE_TAG = COMMIT_HASH
          echo "✅ Using IMAGE_TAG = ${env.IMAGE_TAG}"
        }
      }
    }

    stage('Prepare .env (optional)') {
      steps {
        withCredentials([file(credentialsId: "${ENV_FILE_CREDENTIAL}", variable: 'ENV_FILE')]) {
          sh 'if [ -f "${ENV_FILE}" ]; then cp "${ENV_FILE}" .env && echo ".env copied"; else echo "ENV file not found"; fi'
        }
      }
    }

    stage('Build image') {
      steps {
        script {
          sh """
            echo "Building image: ${DOCKERHUB_NAMESPACE}/${IMAGE_NAME}:${IMAGE_TAG}"
            docker build -f Dockerfile -t ${DOCKERHUB_NAMESPACE}/${IMAGE_NAME}:${IMAGE_TAG} .
          """
        }
      }
    }

    stage('Push image to DockerHub') {
      steps {
        withCredentials([usernamePassword(credentialsId: "${REGISTRY_CREDENTIAL}", usernameVariable: 'DH_USER', passwordVariable: 'DH_PWD')]) {
          sh '''
            echo "Logging into DockerHub..."
            echo "$DH_PWD" | docker login --username "$DH_USER" --password-stdin
            docker push ${DOCKERHUB_NAMESPACE}/${IMAGE_NAME}:${IMAGE_TAG}
            docker logout || true
          '''
        }
      }
    }

    stage('Redeploy via Rancher') {
      steps {
        script {
          withCredentials([string(credentialsId: "${RANCHER_TOKEN_CREDENTIAL}", variable: 'RANCHER_TOKEN')]) {
            sh '''
              WORKLOAD_URL="${RANCHER_URL}/v3/project/${RANCHER_PROJECT_ID}/workloads/deployment:${RANCHER_NAMESPACE}:${RANCHER_DEPLOYMENT_NAME}"
              NEW_IMAGE="${DOCKERHUB_NAMESPACE}/${IMAGE_NAME}:${IMAGE_TAG}"
              
              echo "Updating image to: $NEW_IMAGE"
              
              UPDATE_PAYLOAD=$(curl -s -k \
                -H "Authorization: Bearer ${RANCHER_TOKEN}" \
                "${WORKLOAD_URL}" | jq --arg image "$NEW_IMAGE" \
                '.containers[0].image = $image')
              
              curl -s -k -X PUT \
                -H "Authorization: Bearer ${RANCHER_TOKEN}" \
                -H "Content-Type: application/json" \
                "${WORKLOAD_URL}" \
                -d "$UPDATE_PAYLOAD"
              
              echo "Triggering redeploy..."
              
              curl -s -k -X POST \
                -H "Authorization: Bearer ${RANCHER_TOKEN}" \
                "${WORKLOAD_URL}?action=redeploy"
              
              echo "Done"
            '''
          }
        }
      }
    }

    stage('Cleanup') {
      steps {
        sh """
          docker rmi ${DOCKERHUB_NAMESPACE}/${IMAGE_NAME}:${IMAGE_TAG} || true
          docker image prune -f || true
          [ -f .env ] && rm -f .env || true
        """
      }
    }
  }

  post {
    always {
      sh '[ -f .env ] && rm -f .env || true'
    }
  }
}
